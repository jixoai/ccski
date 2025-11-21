import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSkillFile, validateSkillFile } from "../src/core/parser.js";
import { ParseError, ValidationError } from "../src/types/errors.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

const fixture = (...paths: string[]) => join(fixturesDir, ...paths);

describe("parseSkillFile", () => {
  it("parses valid SKILL.md and normalizes multi-line description", () => {
    const result = parseSkillFile(fixture("valid-basic", "SKILL.md"));

    expect(result.frontmatter.name).toBe("sample-skill");
    expect(result.frontmatter.description).toBe(
      "This is a sample skill spanning multiple lines with extra whitespace."
    );
    expect(result.content).toContain("# Sample Skill");
    expect(result.fullContent.startsWith("---\nname: sample-skill")).toBe(true);
  });

  it("throws ParseError when frontmatter is missing", () => {
    try {
      parseSkillFile(fixture("missing-frontmatter", "SKILL.md"));
      expect.fail("Expected ParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      if (error instanceof ParseError) {
        expect(error.reason).toContain("Missing YAML frontmatter");
        expect(error.suggestions[0]).toContain("frontmatter");
      }
    }
  });

  it("throws ValidationError with helpful message when name is missing", () => {
    try {
      parseSkillFile(fixture("missing-name", "SKILL.md"));
      expect.fail("Expected ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      if (error instanceof ValidationError) {
        expect(error.issues.some((issue) => issue.includes("name"))).toBe(true);
        expect(error.suggestions.some((s) => s.includes("name"))).toBe(true);
      }
    }
  });

  it("surfaces YAML syntax errors from invalid frontmatter", () => {
    try {
      parseSkillFile(fixture("invalid-yaml", "SKILL.md"));
      expect.fail("Expected ParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      if (error instanceof ParseError) {
        expect(error.reason.length).toBeGreaterThan(0);
        expect(error.suggestions.some((s) => s.includes("frontmatter"))).toBe(true);
      }
    }
  });

  it("detects invalid UTF-8 encoding", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ccski-invalid-"));
    const skillPath = join(tempDir, "SKILL.md");

    // Invalid UTF-8 sequence: 0xC3 0x28
    writeFileSync(skillPath, Buffer.from([0xc3, 0x28]));

    try {
      parseSkillFile(skillPath);
      expect.fail("Expected ParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      if (error instanceof ParseError) {
        expect(error.reason).toContain("UTF-8");
        expect(error.suggestions.some((s) => s.includes("UTF-8"))).toBe(true);
      }
    }
  });
});

describe("validateSkillFile", () => {
  it("returns structured errors and suggestions", () => {
    const result = validateSkillFile(fixture("missing-description", "SKILL.md"));

    expect(result.success).toBe(false);
    expect(result.errors.some((err) => err.includes("description"))).toBe(true);
    expect(result.suggestions.some((s) => s.includes("description"))).toBe(true);
  });

  it("reports success for valid skills", () => {
    const result = validateSkillFile(fixture("valid-basic", "SKILL.md"));

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });
});
