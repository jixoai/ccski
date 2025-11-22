import { describe, expect, it } from "vitest";
import { wrap } from "../src/word-wrap/index.js";

const noIndent = { indent: "", newline: "\n", trim: true } as const;

describe("word-wrap", () => {
  it("wraps CJK text by display width", () => {
    const text = "这是一个很长的中文句子需要换行";
    const wrapped = wrap(text, { ...noIndent, width: 6 });
    expect(wrapped).toBe("这是一\n个很长\n的中文\n句子需\n要换行");
  });

  it("wraps emoji clusters correctly", () => {
    const text = "😀😃😄😁😆";
    const wrapped = wrap(text, { ...noIndent, width: 4 });
    expect(wrapped).toBe("😀😃\n😄😁\n😆");
  });

  it("respects cut=false for long words", () => {
    const text = "supercalifragilisticexpialidocious";
    const wrapped = wrap(text, { ...noIndent, width: 10, cut: false });
    expect(wrapped).toBe(text);
  });
});
