import { describe, expect, it } from "vitest";
import { resolveFeishuProcessingHintText } from "./message.js";

describe("resolveFeishuProcessingHintText", () => {
  it("returns Chinese hint for CJK input", () => {
    const hint = resolveFeishuProcessingHintText("帮我查一下今天的投放数据");
    expect(hint).toContain("已收到你的消息");
    expect(hint).toContain("10~60 秒");
  });

  it("returns English hint for Latin input", () => {
    const hint = resolveFeishuProcessingHintText("Please summarize today's campaign changes");
    expect(hint).toContain("Got your message");
    expect(hint).toContain("10-60 seconds");
  });
});
