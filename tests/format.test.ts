import { describe, expect, it } from "vitest";

import { highlight, renderList, setColorEnabled } from "../src/utils/format.js";

describe("format helpers", () => {
  it("strips color when disabled", () => {
    setColorEnabled(false);
    const result = highlight("hello world", "world");
    expect(result).toBe("hello world");
  });

  it("renders spaced list entries with padding", () => {
    setColorEnabled(false);
    const output = renderList([
      { title: "alpha", description: "first item", meta: "(local)" },
      { title: "bravo-long", description: "second item" },
    ]);

    const entries = output.split("\n\n");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("- alpha");
    expect(entries[0]).toContain("(local)");
    expect(entries[0]).toContain("    first item");
    expect(entries[1]).toContain("- bravo-long");
  });
});
