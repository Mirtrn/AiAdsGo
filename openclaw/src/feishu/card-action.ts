import type { IncomingMessage, ServerResponse } from "node:http";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawConfig } from "../config/config.js";
import type { FeishuAccountConfig } from "../config/types.feishu.js";
import type { RuntimeEnv } from "../runtime.js";
import { getChildLogger } from "../logging.js";
import { normalizePluginHttpPath } from "../plugins/http-path.js";
import { registerPluginHttpRoute } from "../plugins/http-registry.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

const logger = getChildLogger({ module: "feishu-card-action" });

export type FeishuCardActionHandler = (
  event: Lark.InteractiveCardActionEvent,
) => Promise<Lark.InteractiveCard | void | undefined>;

export type RegisterFeishuCardActionRouteOptions = {
  cfg: OpenClawConfig;
  accountId: string;
  accountConfig: FeishuAccountConfig;
  runtime?: RuntimeEnv;
  handler?: FeishuCardActionHandler;
};

function resolveDefaultCardCallbackPath(accountId: string): string {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return "/feishu/card-action";
  }
  return `/feishu/${encodeURIComponent(accountId)}/card-action`;
}

function buildErrorCard(message: string): Lark.InteractiveCard {
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: "red",
      title: {
        tag: "plain_text",
        content: "操作执行失败",
      },
    },
    elements: [
      {
        tag: "markdown",
        content: message,
      },
    ],
  };
}

export function registerFeishuCardActionRoute(opts: RegisterFeishuCardActionRouteOptions): {
  path: string | null;
  unregister: () => void;
} {
  const callbackPath = normalizePluginHttpPath(
    opts.accountConfig.cardCallbackPath,
    resolveDefaultCardCallbackPath(opts.accountId),
  );

  if (!callbackPath) {
    return { path: null, unregister: () => {} };
  }

  const cardDispatcher = new Lark.CardActionHandler(
    {
      verificationToken: opts.accountConfig.cardVerificationToken,
      encryptKey: opts.accountConfig.cardEncryptKey,
      loggerLevel: Lark.LoggerLevel.info,
      logger: {
        debug: (msg: string) => {
          logger.debug?.(msg);
        },
        info: (msg: string) => {
          logger.info(msg);
        },
        warn: (msg: string) => {
          logger.warn(msg);
        },
        error: (msg: string) => {
          logger.error(msg);
        },
        trace: (msg: string) => {
          logger.silly?.(msg);
        },
      },
    },
    async (event: Lark.InteractiveCardActionEvent) => {
      if (!opts.handler) {
        return undefined;
      }
      try {
        return await opts.handler(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Feishu card action handler failed (account=${opts.accountId}, open_id=${event?.open_id ?? "unknown"}): ${message}`,
        );
        return buildErrorCard(`⚠️ 卡片回调处理失败：${message}`);
      }
    },
  );

  const requestHandler = Lark.adaptDefault(callbackPath, cardDispatcher, {
    autoChallenge: true,
  });

  const unregister = registerPluginHttpRoute({
    path: callbackPath,
    pluginId: "feishu",
    accountId: opts.accountId,
    log: (message) => opts.runtime?.log?.(message),
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "GET") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("OK");
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      await requestHandler(req, res);
    },
  });

  return { path: callbackPath, unregister };
}
