import { describe, expect, it } from "vitest";
import { isSenderAllowed, normalizeAllowFrom, resolveSenderAllowMatch } from "./access.js";

describe("feishu allowlist matching", () => {
  it("matches sender via senderIds fallback", () => {
    const allow = normalizeAllowFrom(["ou_abc123"]);
    const match = resolveSenderAllowMatch({
      allow,
      senderId: "u_legacy",
      senderIds: ["on_union", "ou_abc123"],
    });

    expect(match.allowed).toBe(true);
    if (match.allowed) {
      expect(match.matchKey).toBe("ou_abc123");
      expect(match.matchSource).toBe("id");
    }
  });

  it("normalizes prefixed and uppercase sender identifiers", () => {
    const allow = normalizeAllowFrom(["feishu:OU_MIXED"]);
    expect(
      isSenderAllowed({
        allow,
        senderId: "unknown",
        senderIds: ["LARK:ou_mixed"],
      }),
    ).toBe(true);
  });

  it("returns false when all sender candidates miss", () => {
    const allow = normalizeAllowFrom(["ou_allowed"]);
    expect(
      isSenderAllowed({
        allow,
        senderId: "ou_other",
        senderIds: ["on_other", "user_other"],
      }),
    ).toBe(false);
  });
});
