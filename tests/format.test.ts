import { describe, expect, it } from "vitest";

import { highlight, renderTable, setColorEnabled } from "../src/utils/format.js";

describe("format helpers", () => {
  it("strips color when disabled", () => {
    setColorEnabled(false);
    const result = highlight("hello world", "world");
    expect(result).toBe("hello world");
  });

  it("renders simple table without box drawing", () => {
    setColorEnabled(false);
    const table = renderTable(["A", "B"], [["1", "2"]]);
    expect(table).toContain("| A | B |");
    expect(table).toContain("| 1 | 2 |");
  });
});
