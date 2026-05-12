import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readPackageVersion } from "../src/package-version.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  };
});

const mockedReadFileSync = vi.mocked(readFileSync);

describe("readPackageVersion", () => {
  afterEach(() => {
    mockedReadFileSync.mockReset();
  });

  it("reads the version from package.json near the runtime entry", () => {
    mockedReadFileSync.mockImplementation((path, options) => {
      expect(path).toBeInstanceOf(URL);
      expect((path as URL).pathname.endsWith("/package.json")).toBe(true);
      expect(options).toBe("utf8");
      return JSON.stringify({ version: "9.8.7" });
    });

    expect(readPackageVersion()).toBe("9.8.7");
  });

  it("falls back to unknown when package.json is unavailable", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("missing");
    });

    expect(readPackageVersion()).toBe("unknown");
  });

  it("falls back to unknown when package.json is malformed", () => {
    mockedReadFileSync.mockReturnValue("{");

    expect(readPackageVersion()).toBe("unknown");
  });

  it("falls back to unknown when package.json has no string version", () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ version: 123 }));

    expect(readPackageVersion()).toBe("unknown");
  });
});
