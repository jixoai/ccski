import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseSkillFile } from "../core/parser.js";
import { RestrictedSkillNameSchema } from "../types/schemas.js";
import { heading, renderList } from "../utils/format.js";
import type {
  RemoveFailureCode,
  RemoveOptions,
  RemovePreview,
  RemoveResult,
  RemoveResultEntry,
  RemoveSkillRequest,
  RemoveSummary,
} from "./types.js";

/**
 * Thrown when no explicit selection is provided and removal would otherwise
 * guess (toggle MultiSelectError pattern): carries a rendered listing.
 */
export class RemoveSelectionError extends Error {
  constructor(
    message: string,
    public listing: string
  ) {
    super(message);
    this.name = "RemoveSelectionError";
  }
}

/** Thrown when an interactive removal is cancelled by the user. */
export class RemoveCancelledError extends Error {
  constructor() {
    super("Removal cancelled.");
    this.name = "RemoveCancelledError";
  }
}

export type RemoveTargetRootCode = "NOT_FOUND" | "NOT_DIRECTORY" | "SYMLINK";

/** Thrown when the target root itself is unusable; invalidates every item. */
export class RemoveTargetRootError extends Error {
  constructor(
    public root: string,
    public code: RemoveTargetRootCode
  ) {
    super(
      code === "NOT_FOUND"
        ? `Target root does not exist: ${root}`
        : code === "SYMLINK"
          ? `Target root is a symbolic link (refused): ${root}`
          : `Target root is not a directory: ${root}`
    );
    this.name = "RemoveTargetRootError";
  }
}

interface RemoveCandidate {
  name: string;
  path: string;
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Assert the root is a real directory (never a symlink) before any item work. */
function assertTargetRoot(root: string): string {
  const resolved = resolve(root);
  const st = lstatSafe(resolved);
  if (st === null) throw new RemoveTargetRootError(resolved, "NOT_FOUND");
  if (st.isSymbolicLink()) throw new RemoveTargetRootError(resolved, "SYMLINK");
  if (!st.isDirectory()) throw new RemoveTargetRootError(resolved, "NOT_DIRECTORY");
  return resolved;
}

/** Direct children (dirs or links) carrying a SKILL.md/.SKILL.md identity file. */
function discoverCandidates(root: string): RemoveCandidate[] {
  if (!existsSync(root)) return [];
  const candidates: RemoveCandidate[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (!existsSync(join(path, "SKILL.md")) && !existsSync(join(path, ".SKILL.md"))) continue;
    candidates.push({ name: entry.name, path });
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

function describeCandidate(path: string): string {
  const identity = existsSync(join(path, "SKILL.md"))
    ? join(path, "SKILL.md")
    : join(path, ".SKILL.md");
  try {
    return parseSkillFile(identity).frontmatter.description;
  } catch {
    return "";
  }
}

function renderListing(candidates: RemoveCandidate[]): string {
  return (
    `${heading("Removable skills")} (${candidates.length})\n` +
    renderList(
      candidates.map((candidate) => ({
        title: candidate.name,
        description: describeCandidate(candidate.path),
      }))
    )
  );
}

function normalizeRequests(requests: Array<string | RemoveSkillRequest>): RemoveSkillRequest[] {
  return requests.map((request) => (typeof request === "string" ? { name: request } : request));
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Active identity file for guard hashing: SKILL.md when present (even beside
 * .SKILL.md), else .SKILL.md; `null` when neither exists (not a skill dir).
 */
function activeIdentityFile(dir: string): string | null {
  const skill = join(dir, "SKILL.md");
  if (lstatSafe(skill) !== null) return skill;
  const disabled = join(dir, ".SKILL.md");
  if (lstatSafe(disabled) !== null) return disabled;
  return null;
}

function failedEntry(
  candidate: RemoveCandidate,
  errorCode: RemoveFailureCode,
  message: string
): RemoveResultEntry {
  return {
    skill: candidate.name,
    path: candidate.path,
    status: "failed",
    errorCode,
    error: message,
  };
}

/** Verify optional guards against the on-disk state right before deletion. */
function verifyGuards(
  candidate: RemoveCandidate,
  request: RemoveSkillRequest
): RemoveResultEntry | null {
  const { expectedContentHash, expectedInode } = request;
  if (expectedContentHash === undefined && expectedInode === undefined) return null;

  if (expectedContentHash !== undefined && !isSha256Hex(expectedContentHash)) {
    return failedEntry(candidate, "GUARD_INVALID", "expectedContentHash must be 64 hex chars (sha256)");
  }
  if (expectedInode !== undefined && (!Number.isInteger(expectedInode) || expectedInode < 0)) {
    return failedEntry(candidate, "GUARD_INVALID", "expectedInode must be a non-negative integer");
  }

  const st = lstatSafe(candidate.path);
  if (st === null) {
    return failedEntry(candidate, "GUARD_MISMATCH", "Directory disappeared before removal");
  }
  if (expectedInode !== undefined && st.ino !== expectedInode) {
    return failedEntry(
      candidate,
      "GUARD_MISMATCH",
      `Inode changed since check (expected ${expectedInode}, found ${st.ino})`
    );
  }

  if (expectedContentHash !== undefined) {
    const identity = activeIdentityFile(candidate.path);
    if (identity === null) {
      return failedEntry(candidate, "GUARD_UNREADABLE", "No identity file to hash");
    }
    const identitySt = lstatSafe(identity);
    if (identitySt === null || !identitySt.isFile()) {
      return failedEntry(
        candidate,
        "GUARD_UNREADABLE",
        `Identity file is not a regular file: ${identity}`
      );
    }
    let actual: string;
    try {
      actual = sha256Hex(readFileSync(identity));
    } catch (err) {
      return failedEntry(
        candidate,
        "GUARD_UNREADABLE",
        `Failed to read identity file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (actual !== expectedContentHash.toLowerCase()) {
      return failedEntry(candidate, "GUARD_MISMATCH", "Content hash changed since check");
    }
  }

  return null;
}

function removeCandidateEntry(root: string, request: RemoveSkillRequest): RemoveResultEntry {
  const validation = RestrictedSkillNameSchema.safeParse(request.name);
  if (!validation.success) {
    const issue = validation.error.errors[0]?.message ?? "invalid skill name";
    return {
      skill: request.name,
      path: "",
      status: "failed",
      errorCode: "INVALID_NAME",
      error: issue,
    };
  }

  const name = validation.data;
  const path = resolve(join(root, name));
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return failedEntry({ name, path }, "PATH_ESCAPE", `Resolved path escapes target root: ${path}`);
  }

  const candidate: RemoveCandidate = { name, path };

  const st = lstatSafe(path);
  if (st === null) {
    return { skill: name, path, status: "skipped", reason: "NOT_FOUND" };
  }
  if (st.isSymbolicLink()) {
    return failedEntry(candidate, "SYMLINK_TARGET", "Refusing to remove a symbolic link");
  }
  if (!st.isDirectory()) {
    return failedEntry(candidate, "NOT_DIRECTORY", "Target exists but is not a directory");
  }
  if (activeIdentityFile(path) === null) {
    return failedEntry(
      candidate,
      "NOT_A_SKILL",
      "Directory has no SKILL.md/.SKILL.md identity file"
    );
  }

  const guardResult = verifyGuards(candidate, request);
  if (guardResult !== null) return guardResult;

  try {
    rmSync(path, { recursive: true, force: false });
  } catch (err) {
    return failedEntry(candidate, "DELETE_FAILED", err instanceof Error ? err.message : String(err));
  }
  return { skill: name, path, status: "removed" };
}

function buildSummary(results: RemoveResultEntry[]): RemoveSummary {
  return {
    results,
    removed: results.filter((r) => r.status === "removed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}

function buildPreview(root: string, selected: RemoveSkillRequest[]): RemovePreview {
  const skills = selected.map((request) => {
    const validation = RestrictedSkillNameSchema.safeParse(request.name);
    const name = validation.success ? validation.data : request.name;
    const path = validation.success ? resolve(join(root, name)) : "";
    return { name, path, exists: path !== "" && lstatSafe(path) !== null };
  });
  return { dryRun: true, skills, totalRemovals: skills.length };
}

async function promptRemovalSelection(
  candidates: RemoveCandidate[]
): Promise<RemoveSkillRequest[]> {
  const listing = renderListing(candidates);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new RemoveSelectionError(
      "Interactive mode requires a TTY. Provide requests or use all.",
      listing
    );
  }
  if (candidates.length === 0) {
    throw new RemoveSelectionError("No removable skills found in target root.", listing);
  }

  const { promptMultiSelect } = await import("../cli/prompts/multiSelect.js");
  const picked = await promptMultiSelect({
    message: "Select skills to remove",
    choices: candidates.map((candidate) => ({
      value: candidate.name,
      label: candidate.name,
      description: describeCandidate(candidate.path),
      checked: false,
    })),
    defaultChecked: false,
  });

  if (!Array.isArray(picked) || picked.length === 0) {
    throw new RemoveSelectionError("No skills selected.", listing);
  }
  const pickedSet = new Set(picked.map((value) => String(value)));
  return candidates
    .filter((candidate) => pickedSet.has(candidate.name))
    .map((candidate) => ({ name: candidate.name }));
}

/**
 * Remove skill directories from an already-resolved target root.
 *
 * Host-guarded primitive: the caller resolves the root and passes it in; ccski
 * enforces restricted names, direct-child containment, lstat/symlink policy,
 * optional swap guards, and idempotent typed per-item statuses.
 */
export async function removeSkills(options: RemoveOptions): Promise<RemoveResult> {
  const root = assertTargetRoot(options.targetRoot);
  const candidates = discoverCandidates(root);

  let selected: RemoveSkillRequest[];
  if (options.requests !== undefined && options.requests.length > 0) {
    selected = normalizeRequests(options.requests);
  } else if (options.all === true) {
    selected = candidates.map((candidate) => ({ name: candidate.name }));
  } else if (options.interactive === true) {
    selected = await promptRemovalSelection(candidates);
  } else {
    throw new RemoveSelectionError(
      "Provide requests, use all, or enable interactive mode (-i).",
      renderListing(candidates)
    );
  }

  if (options.interactive === true && options.yes !== true) {
    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message: `Remove ${selected.length} skill(s) from ${root}?`,
      default: false,
    });
    if (!confirmed) throw new RemoveCancelledError();
  }

  if (options.dryRun === true) {
    return buildPreview(root, selected);
  }

  return buildSummary(selected.map((request) => removeCandidateEntry(root, request)));
}
