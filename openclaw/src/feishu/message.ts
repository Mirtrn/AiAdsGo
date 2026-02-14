import type { Client } from "@larksuiteoapi/node-sdk";
import type { OpenClawConfig } from "../config/config.js";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../auto-reply/reply/provider-dispatcher.js";
import { createReplyPrefixOptions } from "../channels/reply-prefix.js";
import { loadConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { formatErrorMessage } from "../infra/errors.js";
import { getChildLogger } from "../logging.js";
import { isSenderAllowed, normalizeAllowFromWithStore, resolveSenderAllowMatch } from "./access.js";
import {
  resolveFeishuConfig,
  resolveFeishuGroupConfig,
  resolveFeishuGroupEnabled,
  type ResolvedFeishuConfig,
} from "./config.js";
import { resolveFeishuMedia, type FeishuMediaRef } from "./download.js";
import { readFeishuAllowFromStore, upsertFeishuPairingRequest } from "./pairing-store.js";
import { sendMessageFeishu, type FeishuSendOpts } from "./send.js";
import { FeishuStreamingSession } from "./streaming-card.js";

const logger = getChildLogger({ module: "feishu-message" });

const HEALTH_MESSAGE_MAX_LENGTH = 20_000;
const CJK_TEXT_RE = /[\u3400-\u9fff]/;

const FEISHU_PROCESSING_HINT_TEXT_ZH =
  "✅ 已收到你的消息，正在为你执行任务。\n⏱️ 通常会在 10~60 秒内返回结果；复杂任务可能更久。";
const FEISHU_PROCESSING_HINT_TEXT_EN =
  "✅ Got your message — I'm working on it now.\n⏱️ Most replies arrive in 10-60 seconds; complex tasks may take longer.";

export const resolveFeishuProcessingHintText = (messageText: string): string =>
  CJK_TEXT_RE.test(messageText) ? FEISHU_PROCESSING_HINT_TEXT_ZH : FEISHU_PROCESSING_HINT_TEXT_EN;

export function isFeishuGroupSubscriptionError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return (
    message.includes("no active subscription found for this group") ||
    (message.includes("no active subscription found") &&
      (message.includes("group") || message.includes("chat")) &&
      message.includes("403")) ||
    (message.includes("subscription") && message.includes("group") && message.includes("403"))
  );
}

const inferFeishuSenderIdType = (
  id: string | undefined,
): "open_id" | "union_id" | "user_id" | null => {
  if (!id) {
    return null;
  }
  if (id.startsWith("ou_")) {
    return "open_id";
  }
  if (id.startsWith("on_")) {
    return "union_id";
  }
  return null;
};

type FeishuSender = {
  id?: string;
  id_type?: string;
  sender_id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
};

type FeishuMention = {
  key?: string;
};

type FeishuMessage = {
  chat_id?: string;
  chat_type?: string;
  message_type?: string;
  content?: string;
  mentions?: FeishuMention[];
  create_time?: string | number;
  message_id?: string;
};

type FeishuEventPayload = {
  message?: FeishuMessage;
  event?: {
    message?: FeishuMessage;
    sender?: FeishuSender;
  };
  sender?: FeishuSender;
  mentions?: FeishuMention[];
};

// Supported message types for processing
const SUPPORTED_MSG_TYPES = new Set(["text", "image", "file", "audio", "media", "sticker"]);

type FeishuSenderIdentifiers = {
  openId?: string;
  unionId?: string;
  userId?: string;
  primaryId?: string;
  candidates: string[];
};

export type FeishuChatHealthEvent = {
  accountId: string;
  messageId?: string;
  chatId?: string;
  chatType?: string;
  messageType?: string;
  senderPrimaryId?: string;
  senderOpenId?: string;
  senderUnionId?: string;
  senderUserId?: string;
  senderCandidates: string[];
  decision: "allowed" | "blocked" | "error";
  reasonCode: string;
  reasonMessage?: string;
  messageText?: string;
  metadata?: Record<string, unknown>;
};

const normalizeSenderIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }

  const normalized = String(value)
    .trim()
    .replace(/^(feishu|lark):/i, "")
    .toLowerCase();
  return normalized || null;
};

const normalizeHealthText = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return undefined;
  }

  const text = String(value).trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, HEALTH_MESSAGE_MAX_LENGTH);
};

const resolveSenderIdentifiers = (sender?: FeishuSender): FeishuSenderIdentifiers => {
  const rawId = normalizeSenderIdentifier(sender?.id) ?? undefined;
  const rawIdType = String(sender?.id_type ?? "")
    .trim()
    .toLowerCase();
  const inferredRawIdType = inferFeishuSenderIdType(rawId);
  const effectiveRawIdType = rawIdType || inferredRawIdType || "";
  const openId =
    normalizeSenderIdentifier(sender?.sender_id?.open_id) ??
    (effectiveRawIdType === "open_id" ? rawId : undefined);
  const unionId =
    normalizeSenderIdentifier(sender?.sender_id?.union_id) ??
    (effectiveRawIdType === "union_id" ? rawId : undefined);
  const userId =
    normalizeSenderIdentifier(sender?.sender_id?.user_id) ??
    (effectiveRawIdType === "user_id" ? rawId : undefined);
  const candidates = Array.from(
    new Set([openId, unionId, userId, rawId].filter(Boolean)),
  ) as string[];

  return {
    openId,
    unionId,
    userId,
    primaryId: openId ?? unionId ?? userId ?? rawId,
    candidates,
  };
};

const extractTextFromRawMessage = (message?: FeishuMessage): string | undefined => {
  if (!message?.content) {
    return undefined;
  }

  const raw = String(message.content).trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const textValue = normalizeHealthText((parsed as { text?: unknown }).text);
      if (textValue) {
        return textValue;
      }
    }
  } catch {
    // ignore JSON parse failure, fall back to raw content
  }

  return normalizeHealthText(raw);
};

async function resolveSenderOpenIdFromMessageDetail(params: {
  client: Client;
  messageId?: string;
}): Promise<string | null> {
  const messageId = String(params.messageId ?? "").trim();
  if (!messageId) {
    return null;
  }

  try {
    const detail = await params.client.im.message.get({
      params: { user_id_type: "open_id" },
      path: { message_id: messageId },
    });
    const senderId = normalizeSenderIdentifier(detail?.data?.items?.[0]?.sender?.id);
    if (senderId?.startsWith("ou_")) {
      return senderId;
    }
  } catch (err) {
    logger.debug(
      `failed to resolve sender open_id from message detail: ${formatErrorMessage(err)}`,
    );
  }

  return null;
}

export type ProcessFeishuMessageOptions = {
  cfg?: OpenClawConfig;
  accountId?: string;
  resolvedConfig?: ResolvedFeishuConfig;
  /** Feishu app credentials for streaming card API */
  credentials?: { appId: string; appSecret: string; domain?: string };
  /** Bot name for streaming card title (optional, defaults to no title) */
  botName?: string;
  /** Optional health reporter callback for chat pipeline diagnostics */
  healthReporter?: (event: FeishuChatHealthEvent) => Promise<void> | void;
};

export async function processFeishuMessage(
  client: Client,
  data: unknown,
  appId: string,
  options: ProcessFeishuMessageOptions = {},
) {
  const cfg = options.cfg ?? loadConfig();
  const accountId = options.accountId ?? appId;
  const feishuCfg = options.resolvedConfig ?? resolveFeishuConfig({ cfg, accountId });

  const payload = data as FeishuEventPayload;

  // SDK 2.0 schema: data directly contains message, sender, etc.
  const message = payload.message ?? payload.event?.message;
  const sender = payload.sender ?? payload.event?.sender;

  if (!message) {
    logger.warn(`Received event without message field`);
    if (options.healthReporter) {
      try {
        await options.healthReporter({
          accountId,
          senderCandidates: [],
          decision: "blocked",
          reasonCode: "missing_message",
          reasonMessage: "message field missing in event payload",
        });
      } catch (err) {
        logger.debug(`failed to report feishu chat health: ${formatErrorMessage(err)}`);
      }
    }
    return;
  }

  const chatId = message.chat_id;
  if (!chatId) {
    logger.warn("Received message without chat_id");
    if (options.healthReporter) {
      try {
        await options.healthReporter({
          accountId,
          messageId: message.message_id,
          chatType: message.chat_type,
          messageType: message.message_type,
          senderCandidates: [],
          decision: "blocked",
          reasonCode: "missing_chat_id",
          reasonMessage: "chat_id is missing",
          messageText: extractTextFromRawMessage(message),
        });
      } catch (err) {
        logger.debug(`failed to report feishu chat health: ${formatErrorMessage(err)}`);
      }
    }
    return;
  }
  const isGroup = message.chat_type === "group";
  const msgType = message.message_type;
  const senderIdentifiers = resolveSenderIdentifiers(sender);
  let senderId = senderIdentifiers.primaryId ?? "unknown";
  let senderOpenId = senderIdentifiers.openId;
  const senderUnionId = senderIdentifiers.unionId;
  const senderUserId = senderIdentifiers.userId;
  const senderCandidates = [...senderIdentifiers.candidates];
  const maxMediaBytes = feishuCfg.mediaMaxMb * 1024 * 1024;
  let healthMessageText = extractTextFromRawMessage(message);

  const reportHealth = async (params: {
    decision: "allowed" | "blocked" | "error";
    reasonCode: string;
    reasonMessage?: string;
    messageText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> => {
    if (!options.healthReporter) {
      return;
    }

    try {
      await options.healthReporter({
        accountId,
        messageId: message.message_id,
        chatId,
        chatType: message.chat_type,
        messageType: msgType,
        senderPrimaryId: senderId === "unknown" ? undefined : senderId,
        senderOpenId,
        senderUnionId,
        senderUserId,
        senderCandidates: [...senderCandidates],
        decision: params.decision,
        reasonCode: params.reasonCode,
        reasonMessage: params.reasonMessage,
        messageText: normalizeHealthText(params.messageText ?? healthMessageText),
        metadata: params.metadata,
      });
    } catch (err) {
      logger.debug(`failed to report feishu chat health: ${formatErrorMessage(err)}`);
    }
  };

  // Check if this is a supported message type
  if (!msgType || !SUPPORTED_MSG_TYPES.has(msgType)) {
    logger.debug(`Skipping unsupported message type: ${msgType ?? "unknown"}`);
    await reportHealth({
      decision: "blocked",
      reasonCode: "unsupported_message_type",
      reasonMessage: `unsupported message_type: ${msgType ?? "unknown"}`,
    });
    return;
  }

  // Load allowlist from store
  const storeAllowFrom = await readFeishuAllowFromStore().catch(() => []);

  let senderOpenIdLookupDone = false;
  const ensureSenderOpenId = async (): Promise<string | null> => {
    if (senderOpenId) {
      return senderOpenId;
    }
    if (senderOpenIdLookupDone) {
      return null;
    }
    senderOpenIdLookupDone = true;

    const resolvedOpenId = await resolveSenderOpenIdFromMessageDetail({
      client,
      messageId: message.message_id,
    });
    if (!resolvedOpenId) {
      return null;
    }

    senderOpenId = resolvedOpenId;
    senderId = senderOpenId;
    if (!senderCandidates.includes(senderOpenId)) {
      senderCandidates.push(senderOpenId);
    }

    return senderOpenId;
  };

  // ===== Access Control =====

  // Group access control
  if (isGroup) {
    // Check if group is enabled
    if (!resolveFeishuGroupEnabled({ cfg, accountId, chatId })) {
      logVerbose(`Blocked feishu group ${chatId} (group disabled)`);
      await reportHealth({
        decision: "blocked",
        reasonCode: "group_disabled",
        reasonMessage: "group enabled=false",
      });
      return;
    }

    const { groupConfig } = resolveFeishuGroupConfig({ cfg, accountId, chatId });

    // Check group-level allowFrom override
    if (groupConfig?.allowFrom) {
      const groupAllow = normalizeAllowFromWithStore({
        allowFrom: groupConfig.allowFrom,
        storeAllowFrom,
      });
      if (groupAllow.hasEntries && !groupAllow.hasWildcard) {
        await ensureSenderOpenId();
      }
      if (!isSenderAllowed({ allow: groupAllow, senderId, senderIds: senderCandidates })) {
        logVerbose(`Blocked feishu group sender ${senderId} (group allowFrom override)`);
        await reportHealth({
          decision: "blocked",
          reasonCode: "group_allow_override_denied",
          reasonMessage: "sender not in group allowFrom override",
        });
        return;
      }
    }

    // Apply groupPolicy
    const groupPolicy = feishuCfg.groupPolicy;
    if (groupPolicy === "disabled") {
      logVerbose(`Blocked feishu group message (groupPolicy: disabled)`);
      await reportHealth({
        decision: "blocked",
        reasonCode: "group_policy_disabled",
        reasonMessage: "groupPolicy=disabled",
      });
      return;
    }

    if (groupPolicy === "allowlist") {
      const groupAllow = normalizeAllowFromWithStore({
        allowFrom:
          feishuCfg.groupAllowFrom.length > 0 ? feishuCfg.groupAllowFrom : feishuCfg.allowFrom,
        storeAllowFrom,
      });
      if (!groupAllow.hasEntries) {
        logVerbose(`Blocked feishu group message (groupPolicy: allowlist, no entries)`);
        await reportHealth({
          decision: "blocked",
          reasonCode: "group_allowlist_empty",
          reasonMessage: "groupPolicy=allowlist but no entries",
        });
        return;
      }
      if (groupAllow.hasEntries && !groupAllow.hasWildcard) {
        await ensureSenderOpenId();
      }
      if (!isSenderAllowed({ allow: groupAllow, senderId, senderIds: senderCandidates })) {
        logVerbose(`Blocked feishu group sender ${senderId} (groupPolicy: allowlist)`);
        await reportHealth({
          decision: "blocked",
          reasonCode: "group_allowlist_denied",
          reasonMessage: "sender not in group allowlist",
        });
        return;
      }
    }
  }

  // DM access control
  if (!isGroup) {
    const dmPolicy = feishuCfg.dmPolicy;

    if (dmPolicy === "disabled") {
      logVerbose(`Blocked feishu DM (dmPolicy: disabled)`);
      await reportHealth({
        decision: "blocked",
        reasonCode: "dm_policy_disabled",
        reasonMessage: "dmPolicy=disabled",
      });
      return;
    }

    if (dmPolicy !== "open") {
      const dmAllow = normalizeAllowFromWithStore({
        allowFrom: feishuCfg.allowFrom,
        storeAllowFrom,
      });
      if (dmAllow.hasEntries && !dmAllow.hasWildcard) {
        await ensureSenderOpenId();
      }
      const allowMatch = resolveSenderAllowMatch({
        allow: dmAllow,
        senderId,
        senderIds: senderCandidates,
      });
      const allowed = dmAllow.hasWildcard || (dmAllow.hasEntries && allowMatch.allowed);

      if (!allowed) {
        if (dmPolicy === "pairing") {
          // Generate pairing code for unknown sender
          try {
            await ensureSenderOpenId();
            const pairingIdentity =
              senderOpenId ?? senderUnionId ?? senderIdentifiers.userId ?? senderId;
            const pairingReceiveIdType = senderOpenId
              ? "open_id"
              : senderUnionId
                ? "union_id"
                : "user_id";

            const { code, created } = await upsertFeishuPairingRequest({
              openId: pairingIdentity,
              unionId: senderUnionId,
              name: sender?.sender_id?.user_id,
            });
            if (created) {
              logger.info(
                { openId: pairingIdentity, unionId: senderUnionId },
                "feishu pairing request",
              );
              await sendMessageFeishu(
                client,
                pairingIdentity,
                {
                  text: [
                    "OpenClaw access not configured.",
                    "",
                    `Your Feishu Open ID: ${pairingIdentity}`,
                    "",
                    `Pairing code: ${code}`,
                    "",
                    "Ask the OpenClaw admin to approve with:",
                    `openclaw pairing approve feishu ${code}`,
                  ].join("\n"),
                },
                { receiveIdType: pairingReceiveIdType },
              );
            }

            await reportHealth({
              decision: "blocked",
              reasonCode: "dm_pairing_required",
              reasonMessage: "dmPolicy=pairing and sender not allowlisted",
              metadata: {
                pairingCreated: created,
              },
            });
          } catch (err) {
            logger.error(`Failed to create pairing request: ${formatErrorMessage(err)}`);
            await reportHealth({
              decision: "error",
              reasonCode: "dm_pairing_failed",
              reasonMessage: formatErrorMessage(err),
            });
          }
          return;
        }

        // allowlist policy: silently block
        logVerbose(`Blocked feishu DM from ${senderId} (dmPolicy: allowlist)`);
        await reportHealth({
          decision: "blocked",
          reasonCode: "dm_allowlist_denied",
          reasonMessage: "dmPolicy=allowlist and sender not allowlisted",
        });
        return;
      }
    }
  }

  // Handle @mentions for group chats
  const mentions = message.mentions ?? payload.mentions ?? [];
  const wasMentioned = mentions.length > 0;

  // In group chat, check requireMention setting
  if (isGroup) {
    const { groupConfig } = resolveFeishuGroupConfig({ cfg, accountId, chatId });
    const requireMention = groupConfig?.requireMention ?? true;
    if (requireMention && !wasMentioned) {
      logger.debug(`Ignoring group message without @mention (requireMention: true)`);
      await reportHealth({
        decision: "blocked",
        reasonCode: "group_require_mention",
        reasonMessage: "group requires @mention",
      });
      return;
    }
  }

  // Extract text content (for text messages or captions)
  let text = "";
  if (msgType === "text") {
    try {
      if (message.content) {
        const content = JSON.parse(message.content);
        text = content.text || "";
      }
    } catch (err) {
      logger.error(`Failed to parse text message content: ${formatErrorMessage(err)}`);
    }
  }
  if (text) {
    healthMessageText = normalizeHealthText(text);
  }

  // Remove @mention placeholders from text
  for (const mention of mentions) {
    if (mention.key) {
      text = text.replace(mention.key, "").trim();
    }
  }
  if (text) {
    healthMessageText = normalizeHealthText(text);
  }

  // Resolve media if present
  let media: FeishuMediaRef | null = null;
  if (msgType !== "text") {
    try {
      media = await resolveFeishuMedia(client, message, maxMediaBytes);
    } catch (err) {
      logger.error(`Failed to download media: ${formatErrorMessage(err)}`);
    }
  }

  // Build body text
  let bodyText = text;
  if (!bodyText && media) {
    bodyText = media.placeholder;
  }
  healthMessageText = normalizeHealthText(
    bodyText || text || media?.placeholder || healthMessageText,
  );

  // Skip if no content
  if (!bodyText && !media) {
    logger.debug(`Empty message after processing, skipping`);
    await reportHealth({
      decision: "blocked",
      reasonCode: "empty_message",
      reasonMessage: "empty content after mention/media processing",
    });
    return;
  }

  const senderName = sender?.sender_id?.user_id || "unknown";

  // Streaming mode support
  const streamingEnabled = (feishuCfg.streaming ?? true) && Boolean(options.credentials);
  const streamingSession =
    streamingEnabled && options.credentials
      ? new FeishuStreamingSession(client, options.credentials)
      : null;
  let streamingStarted = false;
  let lastPartialText = "";
  const processingHintText = resolveFeishuProcessingHintText(
    bodyText || text || healthMessageText || "",
  );
  let processingHintSent = false;
  let processingHintSending = false;
  let groupSubscriptionFallbackUsed = false;
  let replyUsedOpenId = false;
  let replyPrimaryTargetType:
    | "chat_id"
    | "open_id"
    | "union_id"
    | "user_id"
    | null = null;
  let replyFallbackTargetType:
    | "chat_id"
    | "open_id"
    | "union_id"
    | "user_id"
    | null = null;
  let replyDeliveryErrorKind: "tool" | "block" | "final" | null = null;
  let replyDeliveryErrorMessage: string | null = null;

  const resolvePrimaryReplyTarget = async (): Promise<{
    receiveId: string;
    receiveIdType: "chat_id" | "open_id" | "union_id" | "user_id";
  }> => {
    if (isGroup) {
      return { receiveId: chatId, receiveIdType: "chat_id" };
    }

    const dmOpenId = senderOpenId ?? (await ensureSenderOpenId());
    if (dmOpenId) {
      return { receiveId: dmOpenId, receiveIdType: "open_id" };
    }
    if (senderUnionId) {
      return { receiveId: senderUnionId, receiveIdType: "union_id" };
    }
    if (senderUserId) {
      return { receiveId: senderUserId, receiveIdType: "user_id" };
    }

    return { receiveId: chatId, receiveIdType: "chat_id" };
  };

  const resolveFallbackReplyTargets = async (
    params: { exclude?: string[] } = {},
  ): Promise<Array<{ receiveId: string; receiveIdType: "open_id" | "union_id" | "user_id" }>> => {
    const targets: Array<{ receiveId: string; receiveIdType: "open_id" | "union_id" | "user_id" }> =
      [];
    const seen = new Set<string>(params.exclude ?? []);
    const pushTarget = (
      receiveId: string | null | undefined,
      receiveIdType: "open_id" | "union_id" | "user_id",
    ) => {
      const normalized = String(receiveId || "").trim();
      if (!normalized) {
        return;
      }
      const key = `${receiveIdType}:${normalized}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({ receiveId: normalized, receiveIdType });
    };

    pushTarget(senderOpenId, "open_id");
    const resolvedOpenId = senderOpenId ?? (await ensureSenderOpenId());
    pushTarget(resolvedOpenId, "open_id");
    pushTarget(senderUnionId, "union_id");
    pushTarget(senderUserId, "user_id");

    return targets;
  };

  const sendFeishuReplyWithGroupFallback = async (
    content: Record<string, unknown> | string,
    opts: FeishuSendOpts = {},
  ) => {
    const primaryTarget = await resolvePrimaryReplyTarget();
    replyPrimaryTargetType = primaryTarget.receiveIdType;
    if (primaryTarget.receiveIdType === "open_id") {
      replyUsedOpenId = true;
    }

    try {
      await sendMessageFeishu(client, primaryTarget.receiveId, content, {
        ...opts,
        receiveIdType: primaryTarget.receiveIdType,
      });
      return;
    } catch (err) {
      if (!isFeishuGroupSubscriptionError(err)) {
        throw err;
      }

      const fallbackTargets = await resolveFallbackReplyTargets({
        exclude: [`${primaryTarget.receiveIdType}:${primaryTarget.receiveId}`],
      });
      if (fallbackTargets.length === 0) {
        throw err;
      }

      let lastFallbackError: unknown = err;
      for (const target of fallbackTargets) {
        try {
          groupSubscriptionFallbackUsed = true;
          if (target.receiveIdType === "open_id") {
            replyUsedOpenId = true;
          }
          replyFallbackTargetType = target.receiveIdType;
          logger.warn(
            `Feishu chat ${chatId} (${isGroup ? "group" : "p2p"}) has no active subscription on ${primaryTarget.receiveIdType}, fallback to ${target.receiveIdType} ${target.receiveId}: ${formatErrorMessage(err)}`,
          );
          await sendMessageFeishu(client, target.receiveId, content, {
            ...opts,
            receiveIdType: target.receiveIdType,
          });
          return;
        } catch (fallbackErr) {
          lastFallbackError = fallbackErr;
          logger.warn(
            `Feishu fallback send failed via ${target.receiveIdType} ${target.receiveId}: ${formatErrorMessage(fallbackErr)}`,
          );
        }
      }

      throw lastFallbackError;
    }
  };

  const sendProcessingHint = async () => {
    if (processingHintSent || processingHintSending) {
      return;
    }
    processingHintSending = true;
    try {
      await sendFeishuReplyWithGroupFallback(
        { text: processingHintText },
        {
          msgType: "text",
        },
      );
      processingHintSent = true;
    } catch (err) {
      logger.warn(`Failed to send processing hint message: ${formatErrorMessage(err)}`);
    } finally {
      processingHintSending = false;
    }
  };

  // Context construction
  const ctx = {
    Body: bodyText,
    RawBody: text || media?.placeholder || "",
    From: senderId,
    To: chatId,
    SenderId: senderId,
    SenderName: senderName,
    ChatType: isGroup ? "group" : "dm",
    Provider: "feishu",
    Surface: "feishu",
    Timestamp: Number(message.create_time),
    MessageSid: message.message_id,
    AccountId: accountId,
    OriginatingChannel: "feishu",
    OriginatingTo: chatId,
    // Media fields (similar to Telegram)
    MediaPath: media?.path,
    MediaType: media?.contentType,
    MediaUrl: media?.path,
    WasMentioned: isGroup ? wasMentioned : undefined,
  };

  const agentId = resolveSessionAgentId({ config: cfg });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: "feishu",
    accountId,
  });

  try {
    const dispatchResult = await dispatchReplyWithBufferedBlockDispatcher({
      ctx,
      cfg,
      dispatcherOptions: {
        ...prefixOptions,
        deliver: async (payload, info) => {
          const hasMedia = payload.mediaUrl || (payload.mediaUrls && payload.mediaUrls.length > 0);
          if (!payload.text && !hasMedia) {
            return;
          }

          // Handle block replies - update streaming card with partial text
          if (streamingSession?.isActive() && info?.kind === "block" && payload.text) {
            logger.debug(`Updating streaming card with block text: ${payload.text.length} chars`);
            await streamingSession.update(payload.text);
            return;
          }

          // If streaming was active, close it with the final text
          if (streamingSession?.isActive() && info?.kind === "final") {
            await streamingSession.close(payload.text);
            streamingStarted = false;
            return; // Card already contains the final text
          }

          // Handle media URLs
          const mediaUrls = payload.mediaUrls?.length
            ? payload.mediaUrls
            : payload.mediaUrl
              ? [payload.mediaUrl]
              : [];

          if (mediaUrls.length > 0) {
            // Close streaming session before sending media
            if (streamingSession?.isActive()) {
              await streamingSession.close();
              streamingStarted = false;
            }
            // Send each media item
            for (let i = 0; i < mediaUrls.length; i++) {
              const mediaUrl = mediaUrls[i];
              const caption = i === 0 ? payload.text || "" : "";
              await sendFeishuReplyWithGroupFallback({ text: caption }, { mediaUrl });
            }
          } else if (payload.text) {
            // If streaming wasn't used, send as regular message
            if (!streamingSession?.isActive()) {
              await sendFeishuReplyWithGroupFallback({ text: payload.text }, { msgType: "text" });
            }
          }
        },
        onError: (err, info) => {
          if (!replyDeliveryErrorMessage) {
            replyDeliveryErrorKind = info.kind;
            replyDeliveryErrorMessage = formatErrorMessage(err);
          }
          logger.error(`Reply error: ${formatErrorMessage(err)}`);
          // Clean up streaming session on error
          if (streamingSession?.isActive()) {
            streamingSession.close().catch(() => {});
          }
        },
        onReplyStart: async () => {
          // Start streaming card when reply generation begins
          if (streamingSession && !streamingStarted) {
            try {
              const streamTarget = await resolvePrimaryReplyTarget();
              if (streamTarget.receiveIdType === "open_id") {
                replyUsedOpenId = true;
              }
              await streamingSession.start(
                streamTarget.receiveId,
                streamTarget.receiveIdType,
                options.botName,
                processingHintText,
              );
              streamingStarted = true;
              logger.debug(
                `Started streaming card for ${streamTarget.receiveIdType} ${streamTarget.receiveId}`,
              );
              return;
            } catch (err) {
              logger.warn(`Failed to start streaming card: ${formatErrorMessage(err)}`);
              // Continue without streaming
            }
          }

          await sendProcessingHint();
        },
      },
      replyOptions: {
        disableBlockStreaming: !feishuCfg.blockStreaming,
        onModelSelected,
        onPartialReply: streamingSession
          ? async (payload) => {
              if (!streamingSession.isActive() || !payload.text) {
                return;
              }
              if (payload.text === lastPartialText) {
                return;
              }
              lastPartialText = payload.text;
              await streamingSession.update(payload.text);
            }
          : undefined,
        onReasoningStream: streamingSession
          ? async (payload) => {
              // Also update on reasoning stream for extended thinking models
              if (!streamingSession.isActive() || !payload.text) {
                return;
              }
              if (payload.text === lastPartialText) {
                return;
              }
              lastPartialText = payload.text;
              await streamingSession.update(payload.text);
            }
          : undefined,
      },
    });

    if (replyDeliveryErrorMessage) {
      throw new Error(
        `feishu reply delivery failed (${replyDeliveryErrorKind || "unknown"}): ${replyDeliveryErrorMessage}`,
      );
    }

    if (dispatchResult.skippedDuplicate) {
      await reportHealth({
        decision: "blocked",
        reasonCode: "duplicate_inbound_skipped",
        reasonMessage: "duplicate inbound event skipped by dedupe cache",
        messageText: bodyText,
        metadata: {
          wasMentioned,
          hasMedia: Boolean(media),
        },
      });
      return;
    }

    await reportHealth({
      decision: "allowed",
      reasonCode: "reply_dispatched",
      reasonMessage: "message passed access checks and entered reply pipeline",
      messageText: bodyText,
      metadata: {
        wasMentioned,
        hasMedia: Boolean(media),
        groupSubscriptionFallbackUsed,
        replyUsedOpenId,
        replyPrimaryTargetType,
        replyFallbackTargetType,
      },
    });
  } catch (err) {
    await reportHealth({
      decision: "error",
      reasonCode: "reply_dispatch_failed",
      reasonMessage: formatErrorMessage(err),
      messageText: bodyText,
      metadata: {
        wasMentioned,
        hasMedia: Boolean(media),
        groupSubscriptionFallbackUsed,
        replyUsedOpenId,
        replyPrimaryTargetType,
        replyFallbackTargetType,
        replyDeliveryErrorKind,
        replyDeliveryErrorMessage,
      },
    });
    throw err;
  } finally {
    // Ensure streaming session is closed on completion
    if (streamingSession?.isActive()) {
      await streamingSession.close();
    }
  }
}
