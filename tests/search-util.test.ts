import { describe, expect, it } from "vitest";

import { rankStrings } from "../src/utils/search.js";

describe("rankStrings", () => {
  it("returns indices ordered by best match", () => {
    const list = ["alpha", "beta", "alphabet"];
    const order = rankStrings(list, "alph");
    expect(order.includes(0)).toBe(true);
    expect(order.includes(2)).toBe(true);
    expect(order[0] === 0 || order[0] === 2).toBe(true);
  });

  it("returns empty array for empty query", () => {
    expect(rankStrings(["a"], " ")).toEqual([]);
  });
});
