# Capability: Programmatic API

## ADDED Requirements

### Requirement: Safe skill removal primitive
The package SHALL export a `removeSkills` function that removes skill directories from an already-resolved target root. It MUST accept only restricted skill names (schema-validated: no separators, no traversal, no leading dots, no NUL, no scope prefix) and MUST verify each resolved path stays a direct child of the target root. It MUST NOT accept workspace or provider concepts; the caller resolves roots.

#### Scenario: Successful removal
- **WHEN** a consumer calls `removeSkills` with a valid name and a target root containing that skill directory
- **THEN** the directory is deleted and the per-item status is `removed` with the summary counting it.

#### Scenario: Restricted name rejection
- **WHEN** a requested name contains `/`, `\`, `..`, a leading dot, NUL, or a `:` scope prefix
- **THEN** that item fails with the typed `INVALID_NAME` code and nothing is deleted.

#### Scenario: Symlink target refusal
- **WHEN** the resolved path is a symbolic link
- **THEN** the item fails with the typed `SYMLINK_TARGET` code and the link's destination is untouched.

### Requirement: Idempotent removal results
`removeSkills` SHALL treat a missing target as a successful skip, and SHALL return per-item typed statuses (`removed`/`skipped`/`failed`) with finite reason and error-code vocabularies summarized in a `RemoveSummary` shaped like `InstallSummary`/`ToggleSummary`. A directory without a `SKILL.md`/`.SKILL.md` identity file MUST be refused (`NOT_A_SKILL`), not deleted.

#### Scenario: Idempotent re-removal
- **WHEN** `removeSkills` is called for a name that no longer exists under the root
- **THEN** the item status is `skipped` with reason `NOT_FOUND` and the summary reports a successful skip.

#### Scenario: Partial failure preserves completed items
- **WHEN** a multi-name removal contains one failing item
- **THEN** earlier successful removals remain deleted and the failing item carries its typed failure code.

### Requirement: Guarded removal against body swap
`removeSkills` SHALL accept an optional expected content hash (sha256 hex of the active identity file) and/or expected inode per item; a mismatch MUST fail the item with a typed guard code instead of deleting.

#### Scenario: Content hash mismatch
- **WHEN** the directory's identity file no longer hashes to the expected value
- **THEN** the item fails with `GUARD_MISMATCH` and the directory is preserved.

#### Scenario: Matching guard removes
- **WHEN** the expected hash and inode both match the on-disk state
- **THEN** the item is removed.

### Requirement: Removal selection and multi errors
Without explicit requests, `removeSkills` SHALL remove all discovered skills only when `all` is set; otherwise it MUST throw a `RemoveSelectionError` carrying a rendered listing (toggle `MultiSelectError` pattern). Interactive mode without a TTY throws the same error; cancellation throws `RemoveCancelledError`. A missing, symlinked, or non-directory target root throws `RemoveTargetRootError` before any per-item work.

#### Scenario: No selection provided
- **WHEN** `removeSkills` is called without requests or `all`
- **THEN** it throws `RemoveSelectionError` with a listing of discovered skills and deletes nothing.

#### Scenario: All mode leaves non-skill entries
- **WHEN** `removeSkills` runs with `all` on a root containing two skills and a plain file
- **THEN** both skills are removed and the plain file remains.

### Requirement: Hardened skill directory installation
`installSkillDir` SHALL audit its inputs before writing: the source directory must be a real directory (lstat, symlink-refused), the frontmatter name must pass the restricted name schema, the target root must be a real directory (created when missing, symlink/non-directory refused), and the destination must not be a symlink or non-directory. Path containment MUST be verified after joining name onto root. Existing `installed`/`skipped`/`overwritten` idempotent status semantics SHALL be preserved.

#### Scenario: Symlinked source refused
- **WHEN** the source skill directory is a symbolic link
- **THEN** installation throws a typed `InstallAuditError` with code `SOURCE_SYMLINK` and nothing is written.

#### Scenario: Symlinked destination refused
- **WHEN** the destination path already exists as a symbolic link
- **THEN** installation throws a typed `InstallAuditError` with code `DEST_SYMLINK` and the link target is not written through.

### Requirement: Install overwrite failure recovery
Overwrite installation SHALL stage a full copy inside the target root and swap it into place by rename, restoring the previous directory when the swap fails. A failed staging copy MUST leave the existing installation untouched, and a successful overwrite MUST NOT leave stale files from the previous version.

#### Scenario: Copy failure preserves previous install
- **WHEN** staging the copy fails during a forced overwrite
- **THEN** the previous skill directory remains complete and a typed `COPY_FAILED` error is thrown.

#### Scenario: Clean swap removes stale files
- **WHEN** a skill is reinstalled with force and the new source no longer contains a file present in the old installation
- **THEN** after the overwrite the stale file is gone and the status is `overwritten`.
