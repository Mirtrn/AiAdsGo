import * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawConfig } from "../config/config.js";
import type { FeishuAccountConfig } from "../config/types.feishu.js";
import type { RuntimeEnv } from "../runtime.js";
import { loadConfig } from "../config/config.js";
import { formatErrorMessage } from "../infra/errors.js";
import { getChildLogger } from "../logging.js";
import { resolveFeishuAccount } from "./accounts.js";
import { resolveFeishuConfig } from "./config.js";
import { normalizeFeishuDomain } from "./domain.js";
import { processFeishuMessage, type FeishuChatHealthEvent } from "./message.js";

const logger = getChildLogger({ module: "feishu-monitor" });

const DEFAULT_HEALTH_INGEST_TIMEOUT_MS = 2500;

export type MonitorFeishuOpts = {
  appId?: string;
  appSecret?: string;
  accountId?: string;
  config?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveHealthIngestTimeoutMs(): number {
  const raw = Number(process.env.OPENCLAW_FEISHU_CHAT_HEALTH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_HEALTH_INGEST_TIMEOUT_MS;
  }
  return Math.min(10_000, Math.max(500, Math.round(raw)));
}

function resolveHealthIngestUrl(accountConfig: FeishuAccountConfig): string | null {
  const explicit = readString(process.env.OPENCLAW_FEISHU_CHAT_HEALTH_INGEST_URL);
  if (explicit) {
    return explicit;
  }

  const confirmUrl =
    readString(accountConfig.cardConfirmUrl) || readString(process.env.OPENCLAW_CARD_CONFIRM_URL);
  if (confirmUrl) {
    try {
      const url = new URL(confirmUrl);
      url.pathname = "/api/openclaw/feishu/chat-health/ingest";
      url.search = "";
      return url.toString();
    } catch {
      if (confirmUrl.startsWith("/")) {
        return confirmUrl.replace(
          /\/api\/openclaw\/commands\/confirm\/?$/i,
          "/api/openclaw/feishu/chat-health/ingest",
        );
      }
    }
  }

  const baseUrl =
    readString(process.env.OPENCLAW_PUBLIC_BASE_URL) || readString(process.env.NEXT_PUBLIC_APP_URL);
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, "")}/api/openclaw/feishu/chat-health/ingest`;
}

function resolveHealthIngestAuthToken(accountConfig: FeishuAccountConfig): string | null {
  return (
    readString(accountConfig.cardConfirmAuthToken) ||
    readString(process.env.OPENCLAW_CARD_CONFIRM_TOKEN) ||
    readString(process.env.OPENCLAW_GATEWAY_TOKEN) ||
    null
  );
}

function buildFeishuHealthReporter(params: {
  accountId: string;
  accountConfig: FeishuAccountConfig;
}): ((event: FeishuChatHealthEvent) => Promise<void>) | undefined {
  const ingestUrl = resolveHealthIngestUrl(params.accountConfig);
  if (!ingestUrl) {
    logger.debug(`[${params.accountId}] feishu chat health ingest URL is not configured; skip health reporting`);
    return undefined;
  }

  const authToken = resolveHealthIngestAuthToken(params.accountConfig);
  const timeoutMs = resolveHealthIngestTimeoutMs();

  return async (event: FeishuChatHealthEvent) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          "x-openclaw-channel": "feishu",
          "x-openclaw-sender": event.senderOpenId || event.senderPrimaryId || "",
          "x-openclaw-account-id": params.accountId,
        },
        body: JSON.stringify({
          accountId: params.accountId,
          messageId: event.messageId,
          chatId: event.chatId,
          chatType: event.chatType,
          messageType: event.messageType,
          senderPrimaryId: event.senderPrimaryId,
          senderOpenId: event.senderOpenId,
          senderUnionId: event.senderUnionId,
          senderUserId: event.senderUserId,
          senderCandidates: event.senderCandidates,
          decision: event.decision,
          reasonCode: event.reasonCode,
          reasonMessage: event.reasonMessage,
          messageText: event.messageText,
          metadata: event.metadata,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const shortBody = body.length > 180 ? `${body.slice(0, 180)}...` : body;
        logger.debug(
          `[${params.accountId}] feishu chat health ingest failed (${response.status}): ${shortBody || "empty"}`,
        );
      }
    } catch (err) {
      logger.debug(
        `[${params.accountId}] feishu chat health ingest error: ${formatErrorMessage(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function monitorFeishuProvider(opts: MonitorFeishuOpts = {}): Promise<void> {
  const cfg = opts.config ?? loadConfig();
  const account = resolveFeishuAccount({
    cfg,
    accountId: opts.accountId,
  });

  const appId = opts.appId?.trim() || account.config.appId;
  const appSecret = opts.appSecret?.trim() || account.config.appSecret;
  const domain = normalizeFeishuDomain(account.config.domain);
  const accountId = account.accountId;

  if (!appId || !appSecret) {
    throw new Error(
      `Feishu app ID/secret missing for account "${accountId}" (set channels.feishu.accounts.${accountId}.appId/appSecret or FEISHU_APP_ID/FEISHU_APP_SECRET).`,
    );
  }

  // Resolve effective config for this account
  const feishuCfg = resolveFeishuConfig({ cfg, accountId });

  // Check if account is enabled
  if (!feishuCfg.enabled) {
    logger.info(`Feishu account "${accountId}" is disabled, skipping monitor`);
    return;
  }

  const healthReporter = buildFeishuHealthReporter({
    accountId,
    accountConfig: account.config,
  });

  // Create Lark client for API calls
  const client = new Lark.Client({
    appId,
    appSecret,
    ...(domain ? { domain } : {}),
    logger: {
      debug: (msg) => {
        logger.debug?.(msg);
      },
      info: (msg) => {
        logger.info(msg);
      },
      warn: (msg) => {
        logger.warn(msg);
      },
      error: (msg) => {
        logger.error(msg);
      },
      trace: (msg) => {
        logger.silly?.(msg);
      },
    },
  });

  // Create event dispatcher
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": (data) => {
      logger.info(`Received Feishu message event`);
      void processFeishuMessage(client, data, appId, {
        cfg,
        accountId,
        resolvedConfig: feishuCfg,
        credentials: { appId, appSecret, domain },
        botName: account.name,
        healthReporter,
      }).catch((err) => {
        logger.error(`Error processing Feishu message: ${String(err)}`);
      });
    },
  });

  // Create WebSocket client
  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    ...(domain ? { domain } : {}),
    loggerLevel: Lark.LoggerLevel.info,
    logger: {
      debug: (msg) => {
        logger.debug?.(msg);
      },
      info: (msg) => {
        logger.info(msg);
      },
      warn: (msg) => {
        logger.warn(msg);
      },
      error: (msg) => {
        logger.error(msg);
      },
      trace: (msg) => {
        logger.silly?.(msg);
      },
    },
  });

  // Handle abort signal
  const handleAbort = () => {
    logger.info("Stopping Feishu WS client...");
    // WSClient doesn't have a stop method exposed, but it should handle disconnection
    // We'll let the process handle cleanup
  };

  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", handleAbort, { once: true });
  }

  try {
    logger.info("Starting Feishu WebSocket client...");
    await wsClient.start({ eventDispatcher });
    logger.info("Feishu WebSocket connection established");

    // The WSClient.start() should keep running until disconnected
    // If it returns, we need to keep the process alive
    // Wait for abort signal
    if (opts.abortSignal) {
      await new Promise<void>((resolve) => {
        if (opts.abortSignal?.aborted) {
          resolve();
          return;
        }
        opts.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
    } else {
      // If no abort signal, wait indefinitely
      await new Promise<void>(() => {});
    }
  } finally {
    if (opts.abortSignal) {
      opts.abortSignal.removeEventListener("abort", handleAbort);
    }
  }
}
