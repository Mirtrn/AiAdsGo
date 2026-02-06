import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { sendHandlers } from "./send.js";

const mocks = vi.hoisted(() => ({
  deliverOutboundPayloads: vi.fn(),
  appendAssistantMessageToSessionTranscript: vi.fn(async () => ({ ok: true, sessionFile: "x" })),
  recordSessionMetaFromInbound: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({}),
  };
});

vi.mock("../../channels/plugins/index.js", () => ({
  getChannelPlugin: () => ({ outbound: {} }),
  normalizeChannelId: (value: string) => value,
}));

vi.mock("../../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: () => ({ ok: true, to: "resolved" }),
}));

vi.mock("../../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: mocks.deliverOutboundPayloads,
}));

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    appendAssistantMessageToSessionTranscript: mocks.appendAssistantMessageToSessionTranscript,
    recordSessionMetaFromInbound: mocks.recordSessionMetaFromInbound,
  };
});

const makeContext = (): GatewayRequestContext =>
  ({
    dedupe: new Map(),
  }) as unknown as GatewayRequestContext;

describe("gateway send mirroring", () => {
  it("does not mirror when delivery returns no results", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hi",
        channel: "slack",
        idempotencyKey: "idem-1",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
        }),
      }),
    );
  });

  it("mirrors media filenames when delivery succeeds", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m1", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "caption",
        mediaUrl: "https://example.com/files/report.pdf?sig=1",
        channel: "slack",
        idempotencyKey: "idem-2",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
          text: "caption",
          mediaUrls: ["https://example.com/files/report.pdf?sig=1"],
        }),
      }),
    );
  });

  it("mirrors MEDIA tags as attachments", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m2", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "Here\nMEDIA:https://example.com/image.png",
        channel: "slack",
        idempotencyKey: "idem-3",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
          text: "Here",
          mediaUrls: ["https://example.com/image.png"],
        }),
      }),
    );
  });

  it("lowercases provided session keys for mirroring", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m-lower", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hi",
        channel: "slack",
        idempotencyKey: "idem-lower",
        sessionKey: "agent:main:slack:channel:C123",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:slack:channel:c123",
        }),
      }),
    );
  });

  it("derives a target session key when none is provided", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m3", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hello",
        channel: "slack",
        idempotencyKey: "idem-4",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalled();
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:slack:channel:resolved",
          agentId: "main",
        }),
      }),
    );
  });
});

describe("gateway send channelData", () => {
  it("passes channelData through to outbound payload", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m-card", channel: "feishu" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "ou_123",
        message: "Confirm",
        channel: "feishu",
        idempotencyKey: "idem-card",
        channelData: {
          feishu: {
            card: {
              header: { title: { tag: "plain_text", content: "确认" } },
              elements: [{ tag: "markdown", content: "请确认" }],
            },
          },
        },
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            channelData: {
              feishu: {
                card: expect.objectContaining({ elements: expect.any(Array) }),
              },
            },
          }),
        ],
      }),
    );
  });
});
