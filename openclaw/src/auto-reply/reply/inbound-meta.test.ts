import { describe, expect, it } from "vitest";
import type { TemplateContext } from "../templating.js";
import { buildInboundMetaSystemPrompt } from "./inbound-meta.js";

function extractPayload(prompt: string): Record<string, unknown> {
  const match = prompt.match(/```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("Failed to extract inbound-meta JSON payload");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("buildInboundMetaSystemPrompt", () => {
  it("includes trusted routing identity metadata", () => {
    const prompt = buildInboundMetaSystemPrompt({
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      AccountId: "user-1",
      SenderId: "ou_sender",
      TenantKey: "tenant-demo",
      ChatType: "direct",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload.channel).toBe("feishu");
    expect(payload.account_id).toBe("user-1");
    expect(payload.sender_id).toBe("ou_sender");
    expect(payload.tenant_key).toBe("tenant-demo");
  });

  it("omits tenant_key when not provided", () => {
    const prompt = buildInboundMetaSystemPrompt({
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      AccountId: "user-1",
      SenderId: "ou_sender",
      ChatType: "direct",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload).not.toHaveProperty("tenant_key");
  });
});
