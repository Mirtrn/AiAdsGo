import type { ReplyPayload } from "../../../auto-reply/types.js";
import type { FeishuMsgType } from "../../../feishu/send.js";
import type { ChannelOutboundAdapter } from "../types.js";
import { chunkMarkdownText } from "../../../auto-reply/chunk.js";
import { getFeishuClient } from "../../../feishu/client.js";
import { sendMessageFeishu } from "../../../feishu/send.js";
import { formatErrorMessage } from "../../../infra/errors.js";
import { getChildLogger } from "../../../logging.js";
import { normalizeFeishuTarget } from "../normalize/feishu.js";

const logger = getChildLogger({ module: "feishu-outbound" });

const FEISHU_RECEIVE_ID_TYPES = ["open_id", "user_id", "union_id", "email", "chat_id"] as const;

type FeishuReceiveIdType = (typeof FEISHU_RECEIVE_ID_TYPES)[number];

type FeishuSendTarget = {
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
};

type FeishuChannelData = {
  card?: Record<string, unknown>;
  content?: Record<string, unknown> | string;
  msgType?: FeishuMsgType;
  receiveIdType?: FeishuReceiveIdType;
  openId?: string;
  unionId?: string;
  userId?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveFeishuChannelData(payload: ReplyPayload): FeishuChannelData {
  const channelData = asRecord(payload.channelData);
  const feishuData = asRecord(channelData.feishu);
  const readString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const raw = feishuData[key];
      if (typeof raw !== "string") {
        continue;
      }
      const normalized = raw.trim();
      if (!normalized) {
        continue;
      }
      return normalized;
    }
    return undefined;
  };
  return {
    card:
      feishuData.card && typeof feishuData.card === "object" && !Array.isArray(feishuData.card)
        ? (feishuData.card as Record<string, unknown>)
        : undefined,
    content:
      typeof feishuData.content === "string" ||
      (feishuData.content &&
        typeof feishuData.content === "object" &&
        !Array.isArray(feishuData.content))
        ? (feishuData.content as Record<string, unknown> | string)
        : undefined,
    msgType:
      typeof feishuData.msgType === "string" ? (feishuData.msgType as FeishuMsgType) : undefined,
    receiveIdType:
      typeof feishuData.receiveIdType === "string"
        ? (feishuData.receiveIdType as FeishuChannelData["receiveIdType"])
        : undefined,
    openId: readString("openId", "open_id", "senderOpenId", "sender_open_id", "toOpenId", "to_open_id"),
    unionId: readString(
      "unionId",
      "union_id",
      "senderUnionId",
      "sender_union_id",
      "toUnionId",
      "to_union_id",
    ),
    userId: readString("userId", "user_id", "senderUserId", "sender_user_id", "toUserId", "to_user_id"),
  };
}

function normalizeFeishuReceiveId(target: string): string {
  return normalizeFeishuTarget(target).trim();
}

function stripTypedReceiveIdPrefix(value: string): string {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  for (const type of FEISHU_RECEIVE_ID_TYPES) {
    const prefix = `${type}:`;
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

function resolveReceiveIdTypeFromValue(target: string): FeishuReceiveIdType {
  const trimmed = target.trim().toLowerCase();
  if (trimmed.startsWith("open_id:")) {
    return "open_id";
  }
  if (trimmed.startsWith("union_id:")) {
    return "union_id";
  }
  if (trimmed.startsWith("user_id:")) {
    return "user_id";
  }
  if (trimmed.startsWith("email:")) {
    return "email";
  }
  if (trimmed.startsWith("chat_id:")) {
    return "chat_id";
  }
  if (trimmed.startsWith("ou_")) {
    return "open_id";
  }
  if (trimmed.startsWith("on_")) {
    return "union_id";
  }
  return "chat_id";
}

function resolvePrimaryTarget(params: {
  to: string;
  explicitReceiveIdType?: FeishuReceiveIdType;
}): FeishuSendTarget {
  const normalizedTo = normalizeFeishuReceiveId(params.to);
  if (params.explicitReceiveIdType) {
    return {
      receiveId: stripTypedReceiveIdPrefix(normalizedTo),
      receiveIdType: params.explicitReceiveIdType,
    };
  }
  return {
    receiveId: stripTypedReceiveIdPrefix(normalizedTo),
    receiveIdType: resolveReceiveIdTypeFromValue(normalizedTo),
  };
}

function isFeishuGroupSubscriptionError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return (
    message.includes("no active subscription found for this group") ||
    (message.includes("no active subscription found") &&
      (message.includes("group") || message.includes("chat")) &&
      message.includes("403")) ||
    (message.includes("subscription") && message.includes("group") && message.includes("403"))
  );
}

function resolveFallbackTargets(params: {
  feishuData: FeishuChannelData;
  primary: FeishuSendTarget;
}): FeishuSendTarget[] {
  const targets: FeishuSendTarget[] = [];
  const seen = new Set<string>([`${params.primary.receiveIdType}:${params.primary.receiveId}`]);
  const pushTarget = (receiveId: string | undefined, receiveIdType: FeishuReceiveIdType) => {
    if (!receiveId) {
      return;
    }
    const normalized = stripTypedReceiveIdPrefix(normalizeFeishuReceiveId(receiveId));
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

  pushTarget(params.feishuData.openId, "open_id");
  pushTarget(params.feishuData.unionId, "union_id");
  pushTarget(params.feishuData.userId, "user_id");
  return targets;
}

async function sendWithSubscriptionFallback(params: {
  client: ReturnType<typeof getFeishuClient>;
  target: FeishuSendTarget;
  fallbackTargets: FeishuSendTarget[];
  content: Record<string, unknown> | string;
  msgType?: FeishuMsgType;
  mediaUrl?: string;
  autoRichText?: boolean;
}): Promise<{ message_id?: string } | null> {
  try {
    return await sendMessageFeishu(params.client, params.target.receiveId, params.content, {
      ...(params.msgType ? { msgType: params.msgType } : {}),
      ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
      ...(params.autoRichText !== undefined ? { autoRichText: params.autoRichText } : {}),
      receiveIdType: params.target.receiveIdType,
    });
  } catch (err) {
    if (!isFeishuGroupSubscriptionError(err)) {
      throw err;
    }
    if (params.fallbackTargets.length === 0) {
      throw err;
    }
    let lastError: unknown = err;
    for (const fallbackTarget of params.fallbackTargets) {
      try {
        logger.warn(
          `Feishu outbound subscription error on ${params.target.receiveIdType} ${params.target.receiveId}, fallback to ${fallbackTarget.receiveIdType} ${fallbackTarget.receiveId}: ${formatErrorMessage(err)}`,
        );
        return await sendMessageFeishu(params.client, fallbackTarget.receiveId, params.content, {
          ...(params.msgType ? { msgType: params.msgType } : {}),
          ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
          ...(params.autoRichText !== undefined ? { autoRichText: params.autoRichText } : {}),
          receiveIdType: fallbackTarget.receiveIdType,
        });
      } catch (fallbackErr) {
        lastError = fallbackErr;
        logger.warn(
          `Feishu outbound fallback failed via ${fallbackTarget.receiveIdType} ${fallbackTarget.receiveId}: ${formatErrorMessage(fallbackErr)}`,
        );
      }
    }
    throw lastError;
  }
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 2000,
  sendPayload: async ({ to, payload, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const feishuData = resolveFeishuChannelData(payload);
    const target = resolvePrimaryTarget({
      to,
      explicitReceiveIdType: feishuData.receiveIdType,
    });
    const fallbackTargets = resolveFallbackTargets({
      feishuData,
      primary: target,
    });

    if (feishuData.card) {
      const result = await sendWithSubscriptionFallback({
        client,
        target,
        fallbackTargets,
        content: feishuData.card,
        msgType: "interactive",
        autoRichText: false,
      });
      return {
        channel: "feishu",
        messageId: result?.message_id || "unknown",
        chatId: to,
      };
    }

    if (feishuData.msgType && feishuData.content !== undefined) {
      const result = await sendWithSubscriptionFallback({
        client,
        target,
        fallbackTargets,
        content: feishuData.content,
        msgType: feishuData.msgType,
      });
      return {
        channel: "feishu",
        messageId: result?.message_id || "unknown",
        chatId: to,
      };
    }

    const mediaUrls = payload.mediaUrls?.filter(Boolean) ?? [];
    const mediaUrl = mediaUrls[0] ?? payload.mediaUrl;
    const text = payload.text ?? "";

    const result = await sendWithSubscriptionFallback({
      client,
      target,
      fallbackTargets,
      content: { text },
      ...(mediaUrl ? { mediaUrl } : {}),
    });

    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
  sendText: async ({ to, text, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const target = resolvePrimaryTarget({ to });
    const result = await sendWithSubscriptionFallback({
      client,
      target,
      fallbackTargets: [],
      content: { text },
    });
    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const target = resolvePrimaryTarget({ to });
    const result = await sendWithSubscriptionFallback({
      client,
      target,
      fallbackTargets: [],
      content: { text: text || "" },
      mediaUrl,
    });
    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
};
