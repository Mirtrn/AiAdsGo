import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../config/config.js";
import { feishuOutbound } from "./feishu.js";

const mocks = vi.hoisted(() => ({
  getFeishuClient: vi.fn(() => ({ id: "client" })),
  sendMessageFeishu: vi.fn(async () => ({ message_id: "msg_1" })),
}));

vi.mock("../../../feishu/client.js", () => ({
  getFeishuClient: mocks.getFeishuClient,
}));

vi.mock("../../../feishu/send.js", () => ({
  sendMessageFeishu: mocks.sendMessageFeishu,
}));

describe("feishuOutbound.sendPayload", () => {
  it("sends interactive card when payload carries channelData.feishu.card", async () => {
    mocks.sendMessageFeishu.mockResolvedValueOnce({ message_id: "card_1" });

    const result = await feishuOutbound.sendPayload?.({
      cfg: {} as OpenClawConfig,
      to: "ou_123",
      text: "ignored",
      payload: {
        text: "ignored",
        channelData: {
          feishu: {
            card: {
              header: {
                title: {
                  tag: "plain_text",
                  content: "Confirm",
                },
              },
              elements: [{ tag: "markdown", content: "Please confirm" }],
            },
          },
        },
      },
      accountId: "default",
    });

    expect(mocks.getFeishuClient).toHaveBeenCalledWith("default");
    expect(mocks.sendMessageFeishu).toHaveBeenCalledWith(
      { id: "client" },
      "ou_123",
      expect.objectContaining({ elements: expect.any(Array) }),
      expect.objectContaining({
        msgType: "interactive",
        receiveIdType: "open_id",
        autoRichText: false,
      }),
    );
    expect(result).toEqual({ channel: "feishu", messageId: "card_1", chatId: "ou_123" });
  });

  it("sends explicit feishu msgType/content payload", async () => {
    mocks.sendMessageFeishu.mockResolvedValueOnce({ message_id: "post_1" });

    const result = await feishuOutbound.sendPayload?.({
      cfg: {} as OpenClawConfig,
      to: "oc_123",
      text: "ignored",
      payload: {
        channelData: {
          feishu: {
            msgType: "post",
            content: {
              zh_cn: {
                title: "日报",
                content: [[{ tag: "text", text: "hello" }]],
              },
            },
          },
        },
      },
    });

    expect(mocks.sendMessageFeishu).toHaveBeenCalledWith(
      { id: "client" },
      "oc_123",
      expect.any(Object),
      expect.objectContaining({
        msgType: "post",
        receiveIdType: "chat_id",
      }),
    );
    expect(result).toEqual({ channel: "feishu", messageId: "post_1", chatId: "oc_123" });
  });

  it("normalizes feishu-prefixed open_id targets", async () => {
    mocks.sendMessageFeishu.mockResolvedValueOnce({ message_id: "msg_prefixed" });

    const result = await feishuOutbound.sendText?.({
      cfg: {} as OpenClawConfig,
      to: "feishu:ou_999",
      text: "hello",
      accountId: "default",
    });

    expect(mocks.sendMessageFeishu).toHaveBeenCalledWith(
      { id: "client" },
      "ou_999",
      { text: "hello" },
      expect.objectContaining({
        receiveIdType: "open_id",
      }),
    );
    expect(result).toEqual({ channel: "feishu", messageId: "msg_prefixed", chatId: "feishu:ou_999" });
  });

  it("falls back to open_id when chat_id send hits subscription 403", async () => {
    mocks.sendMessageFeishu.mockReset();
    mocks.sendMessageFeishu
      .mockRejectedValueOnce(new Error("Feishu API Error: 403 No active subscription found for this group"))
      .mockResolvedValueOnce({ message_id: "fallback_1" });

    const result = await feishuOutbound.sendPayload?.({
      cfg: {} as OpenClawConfig,
      to: "oc_group_123",
      text: "ignored",
      payload: {
        text: "hello",
        channelData: {
          feishu: {
            openId: "ou_fallback_123",
          },
        },
      },
      accountId: "default",
    });

    expect(mocks.sendMessageFeishu).toHaveBeenNthCalledWith(
      1,
      { id: "client" },
      "oc_group_123",
      { text: "hello" },
      expect.objectContaining({
        receiveIdType: "chat_id",
      }),
    );
    expect(mocks.sendMessageFeishu).toHaveBeenNthCalledWith(
      2,
      { id: "client" },
      "ou_fallback_123",
      { text: "hello" },
      expect.objectContaining({
        receiveIdType: "open_id",
      }),
    );
    expect(result).toEqual({ channel: "feishu", messageId: "fallback_1", chatId: "oc_group_123" });
  });
});
