import type { ReplyPayload } from "../../../auto-reply/types.js";
import type { FeishuMsgType } from "../../../feishu/send.js";
import type { ChannelOutboundAdapter } from "../types.js";
import { chunkMarkdownText } from "../../../auto-reply/chunk.js";
import { getFeishuClient } from "../../../feishu/client.js";
import { sendMessageFeishu } from "../../../feishu/send.js";

function resolveReceiveIdType(target: string): "open_id" | "union_id" | "chat_id" {
  const trimmed = target.trim().toLowerCase();
  if (trimmed.startsWith("ou_")) {
    return "open_id";
  }
  if (trimmed.startsWith("on_")) {
    return "union_id";
  }
  return "chat_id";
}

type FeishuChannelData = {
  card?: Record<string, unknown>;
  content?: Record<string, unknown> | string;
  msgType?: FeishuMsgType;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveFeishuChannelData(payload: ReplyPayload): FeishuChannelData {
  const channelData = asRecord(payload.channelData);
  const feishuData = asRecord(channelData.feishu);
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
  };
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 2000,
  sendPayload: async ({ to, payload, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const feishuData = resolveFeishuChannelData(payload);
    const receiveIdType = feishuData.receiveIdType ?? resolveReceiveIdType(to);

    if (feishuData.card) {
      const result = await sendMessageFeishu(client, to, feishuData.card, {
        msgType: "interactive",
        receiveIdType,
        autoRichText: false,
      });
      return {
        channel: "feishu",
        messageId: result?.message_id || "unknown",
        chatId: to,
      };
    }

    if (feishuData.msgType && feishuData.content !== undefined) {
      const result = await sendMessageFeishu(client, to, feishuData.content, {
        msgType: feishuData.msgType,
        receiveIdType,
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

    const result = await sendMessageFeishu(
      client,
      to,
      { text },
      {
        ...(mediaUrl ? { mediaUrl } : {}),
        receiveIdType,
      },
    );

    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
  sendText: async ({ to, text, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const result = await sendMessageFeishu(
      client,
      to,
      { text },
      {
        receiveIdType: resolveReceiveIdType(to),
      },
    );
    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const client = getFeishuClient(accountId ?? undefined);
    const result = await sendMessageFeishu(
      client,
      to,
      { text: text || "" },
      { mediaUrl, receiveIdType: resolveReceiveIdType(to) },
    );
    return {
      channel: "feishu",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
};
