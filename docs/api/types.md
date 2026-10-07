# Types

The package exports all API option/result types. Common ones:

- `ListOptions`, `InfoOptions`, `SearchOptions`, `ValidateOptions`
- `SkillInfoResult`, `SearchResultItem`, `ValidateResult`, `FilterOptions`
- `WorkflowInstallOptions`, `WorkflowInstallResult`, `WorkflowInstallResultEntry`
- Kernel (3.0): `EnsureEntityOptions`, `EnsureEntityResult`, `EntitySnapshot`,
  `ProjectEntityOptions`, `ProjectEntityResult`, `ProjectRootResult`,
  `EntityRemoveOptions`, `EntityRemoveResult`, `DeleteEntityOptions`,
  `DeleteEntityResult`, `EntityToggleOptions`, `EntityToggleResult`,
  `EntityUpdateOptions`, `EntityUpdateResult`
- Command face (3.0): `MigratePlan`, `MigrateResult`, `GcResult`, `GcProposal`,
  `RepairResult`, `RepairDiffItem`, `ClaimResult`
- Discovery: `DiscoveryOptions`, `DiscoveryResult`, `DiscoveryOmission`,
  `SkillMetadata` (with `canonicalPath` / `entryKind` / `ownership` / `mode` /
  `provenance` / `stale`), `Skill`, `SkillRegistryOptions`

Removed in 3.0: the 2.x mutation types (`InstallOptions`, `InstallResult`,
`InstallSummary`, `InstallPreview`, `ToggleOptions`, `ToggleSummary`, ...). No
aliases are provided.

See the exported `.d.ts` for full definitions.
