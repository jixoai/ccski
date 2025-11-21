/**
 * Base error class for ccski errors
 */
export class CcskiError extends Error {
  public readonly suggestions: string[];

  constructor(message: string, suggestions: string[] = []) {
    super(message);
    this.name = "CcskiError";
    this.suggestions = suggestions;
  }
}

/**
 * Error thrown when a skill is not found
 */
export class SkillNotFoundError extends CcskiError {
  constructor(
    public skillName: string,
    suggestions: string[] = []
  ) {
    super(`Skill '${skillName}' not found`, suggestions);
    this.name = "SkillNotFoundError";
  }
}

/**
 * Error thrown when a skill name is ambiguous
 */
export class AmbiguousSkillNameError extends CcskiError {
  constructor(
    public skillName: string,
    public matches: string[]
  ) {
    super(
      `Skill name '${skillName}' is ambiguous. Multiple skills found: ${matches.join(", ")}`
    );
    this.name = "AmbiguousSkillNameError";
  }
}

/**
 * Error thrown when skill validation fails
 */
export class ValidationError extends CcskiError {
  constructor(
    public filePath: string,
    public issues: string[],
    suggestions: string[] = []
  ) {
    super(`Validation failed for ${filePath}: ${issues.join(", ")}`, suggestions);
    this.name = "ValidationError";
  }
}

/**
 * Error thrown when parsing SKILL.md fails
 */
export class ParseError extends CcskiError {
  constructor(
    public filePath: string,
    public reason: string,
    suggestions: string[] = []
  ) {
    super(`Failed to parse ${filePath}: ${reason}`, suggestions);
    this.name = "ParseError";
  }
}
