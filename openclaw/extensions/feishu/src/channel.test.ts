import { describe, expect, it } from "vitest";
import { feishuPlugin } from "./channel.js";

describe("feishu status summary", () => {
  it("derives linked from probe result when snapshot.linked is missing", async () => {
    const build = feishuPlugin.status?.buildChannelSummary;
    expect(build).toBeTypeOf("function");
    if (!build) {
      return;
    }

    const summary = await build({
      account: {
        accountId: "main",
        name: "main",
        enabled: true,
        tokenSource: "config",
        config: {
          appId: "cli_xxx",
          appSecret: "secret",
        },
      },
      cfg: {} as never,
      defaultAccountId: "main",
      snapshot: {
        accountId: "main",
        configured: true,
        probe: { ok: true },
      },
    });

    expect(summary.configured).toBe(true);
    expect(summary.linked).toBe(true);
  });

  it("falls back to configured when probe/link data is unavailable", async () => {
    const build = feishuPlugin.status?.buildChannelSummary;
    expect(build).toBeTypeOf("function");
    if (!build) {
      return;
    }

    const summary = await build({
      account: {
        accountId: "main",
        name: "main",
        enabled: true,
        tokenSource: "config",
        config: {
          appId: "cli_xxx",
          appSecret: "secret",
        },
      },
      cfg: {} as never,
      defaultAccountId: "main",
      snapshot: {
        accountId: "main",
        configured: false,
      },
    });

    expect(summary.configured).toBe(false);
    expect(summary.linked).toBe(false);
  });
});
