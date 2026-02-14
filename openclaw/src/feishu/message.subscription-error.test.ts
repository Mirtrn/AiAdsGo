import { describe, expect, it } from "vitest";
import { isFeishuGroupSubscriptionError } from "./message.js";

describe("isFeishuGroupSubscriptionError", () => {
  it("matches explicit no active subscription message", () => {
    expect(
      isFeishuGroupSubscriptionError(
        new Error("Feishu API Error: No active subscription found for this group"),
      ),
    ).toBe(true);
  });

  it("matches generic 403 subscription/group message", () => {
    expect(
      isFeishuGroupSubscriptionError(new Error("403 forbidden: group subscription not active")),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isFeishuGroupSubscriptionError(new Error("Feishu API Error: invalid tenant"))).toBe(
      false,
    );
  });
});
