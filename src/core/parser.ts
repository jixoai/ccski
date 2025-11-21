import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import matter from "gray-matter";
import { ParseError, ValidationError } from "../types/errors.js";
import { SkillFrontmatterSchema } from "../types/schemas.js";
import type { SkillFrontmatter } from "../types/skill.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

/**
 * Parse result from parseSkillFile
 */
export interface ParseResult {
  frontmatter: SkillFrontmatter;
  content: string;
  fullContent: string; // Including frontmatter
}

/**
 * Parse a SKILL.md file and extract frontmatter and content
 *
 * @param filePath - Absolute path to SKILL.md file
 * @returns Parsed frontmatter and content
 * @throws {ParseError} If file cannot be read or parsed
 * @throws {ValidationError} If frontmatter validation fails
 */
export function parseSkillFile(filePath: string): ParseResult {
  let fileBuffer: Buffer;
  try {
    fileBuffer = readFileSync(filePath);
  } catch (error) {
    throw new ParseError(
      filePath,
      error instanceof Error ? error.message : "Failed to read file"
    );
  }

  let fileContent: string;
  try {
    fileContent = utf8Decoder.decode(fileBuffer);
  } catch {
    throw new ParseError(filePath, "Invalid UTF-8 encoding", [
      "Ensure SKILL.md is saved with UTF-8 encoding (no BOM).",
      "If the file was copied from another editor, re-save it as UTF-8.",
    ]);
  }

  const trimmedContent = fileContent.trimStart();
  if (!trimmedContent.startsWith("---")) {
    throw new ParseError(filePath, "Missing YAML frontmatter", [
      "Add a YAML frontmatter block at the top of SKILL.md:",
      "---",
      "name: <skill-name>",
      "description: <what the skill does>",
      "---",
    ]);
  }

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(fileContent);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid YAML frontmatter";
    throw new ParseError(filePath, reason, [
      "Check the YAML frontmatter for syntax issues (colons, indentation).",
      "Ensure the frontmatter is wrapped between leading and trailing '---' lines.",
    ]);
  }

  const validation = SkillFrontmatterSchema.safeParse(parsed.data);
  if (!validation.success) {
    const issues: string[] = [];
    const suggestions: string[] = [];

    for (const issue of validation.error.errors) {
      const path = issue.path.join(".") || "frontmatter";

      if (issue.code === "invalid_type" && issue.message === "Required") {
        issues.push(`Missing required field '${path}' in ${filePath}`);
        suggestions.push(`Add '${path}: <value>' to the YAML frontmatter.`);
        continue;
      }

      if (issue.code === "too_small") {
        issues.push(`${path}: ${issue.message}`);
        suggestions.push(`Provide a non-empty value for '${path}'.`);
        continue;
      }

      issues.push(`${path}: ${issue.message}`);
    }

    if (suggestions.length === 0) {
      suggestions.push("Ensure SKILL.md frontmatter includes non-empty 'name' and 'description' fields.");
    }

    throw new ValidationError(filePath, issues, suggestions);
  }

  const frontmatter = validation.data as SkillFrontmatter;
  const normalizedFrontmatter: SkillFrontmatter = {
    ...frontmatter,
    description: normalizeDescription(frontmatter.description),
  };

  return {
    frontmatter: normalizedFrontmatter,
    content: parsed.content,
    fullContent: fileContent,
  };
}

/**
 * Validate a SKILL.md file without throwing errors
 *
 * @param filePath - Absolute path to SKILL.md file
 * @returns Validation result with success flag and error messages
 */
export function validateSkillFile(filePath: string): {
  success: boolean;
  errors: string[];
  suggestions: string[];
} {
  try {
    parseSkillFile(filePath);
    return { success: true, errors: [], suggestions: [] };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        success: false,
        errors: error.issues,
        suggestions: error.suggestions,
      };
    }
    if (error instanceof ParseError) {
      return {
        success: false,
        errors: [error.reason],
        suggestions: error.suggestions,
      };
    }
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      suggestions: [],
    };
  }
}
