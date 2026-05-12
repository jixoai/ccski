import { readFileSync } from "node:fs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as unknown;

    if (isRecord(packageJson) && typeof packageJson.version === "string") {
      return packageJson.version;
    }
  } catch {
    // Keep --version functional even when package metadata is unavailable.
  }

  return "unknown";
}
