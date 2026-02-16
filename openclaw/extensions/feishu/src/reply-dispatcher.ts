import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type ReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import type { MentionTarget } from "./mention.js";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { buildMentionedCardContent } from "./mention.js";
import { getFeishuRuntime } from "./runtime.js";
import { sendMarkdownCardFeishu, sendMessageFeishu } from "./send.js";
import { FeishuStreamingSession } from "./streaming-card.js";
import { resolveReceiveIdType } from "./targets.js";
import { addTypingIndicator, removeTypingIndicator, type TypingIndicatorState } from "./typing.js";

/** Detect if text contains markdown elements that benefit from card rendering */
function shouldUseCard(text: string): boolean {
  return /```[\s\S]*?```/.test(text) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(text);
}

type AgentEventEnvelope = {
  stream?: string;
  data?: Record<string, unknown>;
};

type ProgressToolStatus = "running" | "completed" | "failed";

type ProgressToolState = {
  toolCallId: string;
  name: string;
  status: ProgressToolStatus;
  updatedAt: number;
};

const FEISHU_PROGRESS_RENDER_THROTTLE_MS = 1200;
const FEISHU_PROGRESS_MAX_LINES = 6;

function normalizeProgressToolName(value: unknown): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "tool";
  }
  return normalized.slice(0, 80);
}

function formatProgressToolLine(tool: ProgressToolState): string {
  const marker =
    tool.status === "completed" ? "[OK]"
      : tool.status === "failed" ? "[ERR]"
        : "[RUN]";
  return `${marker} ${tool.name}`;
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  mentionTargets?: MentionTarget[];
  accountId?: string;
  onFirstReplyDispatched?: () => void;
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  let typingState: TypingIndicatorState | null = null;
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) {
        return;
      }
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId, accountId });
    },
    stop: async () => {
      if (!typingState) {
        return;
      }
      await removeTypingIndicator({ cfg, state: typingState, accountId });
      typingState = null;
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "feishu", accountId, {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" });
  const renderMode = account.config?.renderMode ?? "auto";
  const streamingEnabled = account.config?.streaming !== false && renderMode !== "raw";

  let streaming: FeishuStreamingSession | null = null;
  let streamText = "";
  let lastPartial = "";
  let partialUpdateQueue: Promise<void> = Promise.resolve();
  let streamingStartPromise: Promise<void> | null = null;
  let firstReplyDispatched = false;
  let progressStartedAt = 0;
  let progressLastRenderAt = 0;
  let progressSyntheticId = 0;
  let progressEventCount = 0;
  const progressToolsById = new Map<string, ProgressToolState>();

  const markFirstReplyDispatched = () => {
    if (firstReplyDispatched) {
      return;
    }
    firstReplyDispatched = true;
    params.onFirstReplyDispatched?.();
  };

  const renderProgressText = (): string => {
    const now = Date.now();
    const elapsedSeconds = progressStartedAt > 0 ? Math.max(0, Math.floor((now - progressStartedAt) / 1000)) : 0;
    const toolStates = Array.from(progressToolsById.values());
    const running = toolStates.filter((tool) => tool.status === "running").length;
    const completed = toolStates.filter((tool) => tool.status === "completed").length;
    const failed = toolStates.filter((tool) => tool.status === "failed").length;
    const recent = toolStates
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, FEISHU_PROGRESS_MAX_LINES);

    const lines: string[] = [
      "⏳ 正在处理请求",
      elapsedSeconds > 0
        ? `已用时 ${elapsedSeconds}s · 进度事件 ${progressEventCount}`
        : "已接收请求，正在启动执行",
      `运行中 ${running} · 已完成 ${completed} · 失败 ${failed}`,
    ];

    if (recent.length > 0) {
      lines.push("", "步骤状态：");
      for (const tool of recent) {
        lines.push(formatProgressToolLine(tool));
      }
    }

    lines.push("", "处理中，完成后会自动发送最终结果。");
    return lines.join("\n");
  };

  const pushProgressUpdate = async (force = false): Promise<void> => {
    if (!streamingEnabled) {
      return;
    }

    const now = Date.now();
    if (!force && now - progressLastRenderAt < FEISHU_PROGRESS_RENDER_THROTTLE_MS) {
      return;
    }

    startStreaming();
    if (streamingStartPromise) {
      await streamingStartPromise;
    }
    if (!streaming?.isActive()) {
      return;
    }

    streamText = renderProgressText();
    await streaming.update(streamText);
    progressLastRenderAt = now;
    markFirstReplyDispatched();
  };

  const startStreaming = () => {
    if (!streamingEnabled || streamingStartPromise || streaming) {
      return;
    }
    streamingStartPromise = (async () => {
      const creds =
        account.appId && account.appSecret
          ? { appId: account.appId, appSecret: account.appSecret, domain: account.domain }
          : null;
      if (!creds) {
        return;
      }

      streaming = new FeishuStreamingSession(createFeishuClient(account), creds, (message) =>
        params.runtime.log?.(`feishu[${account.accountId}] ${message}`),
      );
      try {
        await streaming.start(chatId, resolveReceiveIdType(chatId));
      } catch (error) {
        params.runtime.error?.(`feishu: streaming start failed: ${String(error)}`);
        streaming = null;
      }
    })();
  };

  const closeStreaming = async () => {
    if (streamingStartPromise) {
      await streamingStartPromise;
    }
    await partialUpdateQueue;
    if (streaming?.isActive()) {
      let text = streamText;
      if (mentionTargets?.length) {
        text = buildMentionedCardContent(mentionTargets, text);
      }
      await streaming.close(text);
    }
    streaming = null;
    streamingStartPromise = null;
    streamText = "";
    lastPartial = "";
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        if (streamingEnabled && renderMode === "card") {
          startStreaming();
        }
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        if (!text.trim()) {
          return;
        }
        markFirstReplyDispatched();

        const useCard = renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        if ((info?.kind === "block" || info?.kind === "final") && streamingEnabled && useCard) {
          startStreaming();
          if (streamingStartPromise) {
            await streamingStartPromise;
          }
        }

        if (streaming?.isActive()) {
          if (info?.kind === "final") {
            streamText = text;
            await closeStreaming();
          }
          return;
        }

        let first = true;
        if (useCard) {
          for (const chunk of core.channel.text.chunkTextWithMode(
            text,
            textChunkLimit,
            chunkMode,
          )) {
            await sendMarkdownCardFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: first ? mentionTargets : undefined,
              accountId,
            });
            first = false;
          }
        } else {
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
          for (const chunk of core.channel.text.chunkTextWithMode(
            converted,
            textChunkLimit,
            chunkMode,
          )) {
            await sendMessageFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: first ? mentionTargets : undefined,
              accountId,
            });
            first = false;
          }
        }
      },
      onError: async (error, info) => {
        params.runtime.error?.(
          `feishu[${account.accountId}] ${info.kind} reply failed: ${String(error)}`,
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        typingCallbacks.onCleanup?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      onAgentEvent: streamingEnabled
        ? async (evt: AgentEventEnvelope) => {
            const stream = String(evt?.stream || "").trim().toLowerCase();
            const data = (evt?.data && typeof evt.data === "object" ? evt.data : {}) as Record<
              string,
              unknown
            >;

            if (stream === "lifecycle") {
              const phase = String(data.phase || "").trim().toLowerCase();
              if (phase === "start" && progressStartedAt <= 0) {
                progressStartedAt = Date.now();
                await pushProgressUpdate(true);
              }
              if (phase === "error" || phase === "end") {
                await pushProgressUpdate(true);
              }
              return;
            }

            if (stream !== "tool") {
              return;
            }

            const phase = String(data.phase || "").trim().toLowerCase();
            const toolName = normalizeProgressToolName(data.name);
            const rawToolCallId = String(data.toolCallId || data.tool_call_id || "").trim();
            const toolCallId = rawToolCallId || `synthetic_${++progressSyntheticId}`;
            const now = Date.now();

            if (progressStartedAt <= 0) {
              progressStartedAt = now;
            }

            const previous = progressToolsById.get(toolCallId);
            const status: ProgressToolStatus =
              phase === "result"
                ? (Boolean(data.isError) ? "failed" : "completed")
                : "running";

            progressToolsById.set(toolCallId, {
              toolCallId,
              name: toolName || previous?.name || "tool",
              status,
              updatedAt: now,
            });
            progressEventCount += 1;

            await pushProgressUpdate(phase === "start" || phase === "result");
          }
        : undefined,
      onPartialReply: streamingEnabled
        ? (payload: ReplyPayload) => {
            if (!payload.text || payload.text === lastPartial) {
              return;
            }
            lastPartial = payload.text;
            streamText = payload.text;
            partialUpdateQueue = partialUpdateQueue.then(async () => {
              if (streamingStartPromise) {
                await streamingStartPromise;
              }
              if (streaming?.isActive()) {
                await streaming.update(streamText);
              }
            });
          }
        : undefined,
    },
    markDispatchIdle,
  };
}
