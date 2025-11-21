# Implementation Tasks

## 1. Project Setup

- [ ] 1.1 Initialize package.json with project metadata
- [ ] 1.2 Configure TypeScript (tsconfig.json) with strict mode
- [ ] 1.3 Configure tsdown for building (tsdown.config.ts)
- [ ] 1.4 Configure vitest for testing (vitest.config.ts)
- [ ] 1.5 Configure prettier with plugins (organize-imports, tailwindcss)
- [ ] 1.6 Set up .gitignore for TypeScript projects
- [ ] 1.7 Create initial directory structure (src/, tests/)

## 2. Core Type Definitions

- [ ] 2.1 Define Skill interface (name, description, location, path, content, etc.)
- [ ] 2.2 Define SkillMetadata interface (hasReferences, hasScripts, hasAssets)
- [ ] 2.3 Define SkillLocation type (user | project | plugin)
- [ ] 2.4 Create Zod schemas for SKILL.md frontmatter validation
- [ ] 2.5 Create Zod schema for installed_plugins.json
- [ ] 2.6 Define error types (SkillNotFoundError, ValidationError, etc.)

## 3. Skill Parsing Module

- [ ] 3.1 Implement YAML frontmatter parser (src/core/parser.ts)
- [ ] 3.2 Implement required field validation (name, description)
- [ ] 3.3 Implement UTF-8 encoding validation
- [ ] 3.4 Implement skill content extraction (preserve formatting)
- [ ] 3.5 Implement error messages with suggestions
- [ ] 3.6 Write unit tests for parser (all scenarios from spec)

## 4. Skill Discovery Module

- [ ] 4.1 Implement directory scanner (src/core/discovery.ts)
- [ ] 4.2 Implement priority-based directory resolution
- [ ] 4.3 Implement SKILL.md detection in subdirectories
- [ ] 4.4 Implement bundled resource detection (references/, scripts/, assets/)
- [ ] 4.5 Implement custom skill directory support (--skill-dir)
- [ ] 4.6 Handle non-existent and permission errors gracefully
- [ ] 4.7 Write unit tests for discovery (all scenarios from spec)

## 5. Plugin Support Module

- [ ] 5.1 Implement installed_plugins.json parser (src/core/plugins.ts)
- [ ] 5.2 Implement recursive plugin directory scanning
- [ ] 5.3 Implement namespaced skill names (plugin:skill)
- [ ] 5.4 Implement short name resolution (with ambiguity detection)
- [ ] 5.5 Implement plugin priority (lowest priority)
- [ ] 5.6 Implement --no-plugins flag support
- [ ] 5.7 Write unit tests for plugin support (all scenarios from spec)

## 6. Skill Registry

- [ ] 6.1 Implement SkillRegistry class (src/core/registry.ts)
- [ ] 6.2 Implement skill registration with priority resolution
- [ ] 6.3 Implement skill lookup (by name, case-insensitive)
- [ ] 6.4 Implement fuzzy search for suggestions
- [ ] 6.5 Implement refresh mechanism
- [ ] 6.6 Implement diagnostic output
- [ ] 6.7 Write unit tests for registry

## 7. CLI - List Command

- [ ] 7.1 Implement table formatter (src/cli/formatters.ts)
- [ ] 7.2 Implement JSON formatter
- [ ] 7.3 Implement location grouping
- [ ] 7.4 Implement list command (src/cli/commands/list.ts)
- [ ] 7.5 Handle --format flag
- [ ] 7.6 Write integration tests for list command

## 8. CLI - Info Command

- [ ] 8.1 Implement info formatter (metadata + preview)
- [ ] 8.2 Implement full content display (--full flag)
- [ ] 8.3 Implement info command (src/cli/commands/info.ts)
- [ ] 8.4 Implement "skill not found" with suggestions
- [ ] 8.5 Write integration tests for info command

## 9. CLI - Search Command

- [ ] 9.1 Implement case-insensitive search in name/description
- [ ] 9.2 Implement content search (--content flag)
- [ ] 9.3 Implement keyword highlighting
- [ ] 9.4 Implement search command (src/cli/commands/search.ts)
- [ ] 9.5 Write integration tests for search command

## 10. CLI - Validate Command

- [ ] 10.1 Implement SKILL.md validation logic
- [ ] 10.2 Implement validation error messages with suggestions
- [ ] 10.3 Implement validation success output
- [ ] 10.4 Implement validate command (src/cli/commands/validate.ts)
- [ ] 10.5 Support both directory and file paths
- [ ] 10.6 Write integration tests for validate command

## 11. CLI - Main Entry Point

- [ ] 11.1 Implement argument parsing (src/cli/index.ts)
- [ ] 11.2 Implement command routing
- [ ] 11.3 Implement --help and --version
- [ ] 11.4 Implement error handling and exit codes
- [ ] 11.5 Implement stdout/stderr separation
- [ ] 11.6 Add color support (detect TTY)
- [ ] 11.7 Write integration tests for CLI

## 12. MCP Server - Core

- [ ] 12.1 Install @modelcontextprotocol/sdk dependency
- [ ] 12.2 Implement MCP server initialization (src/mcp/server.ts)
- [ ] 12.3 Implement stdio transport
- [ ] 12.4 Implement skill registry initialization on startup
- [ ] 12.5 Implement graceful shutdown (SIGINT, SIGTERM)
- [ ] 12.6 Write unit tests for MCP server initialization

## 13. MCP Server - Skill Tool

- [ ] 13.1 Implement skill tool definition (src/mcp/tools/skill.ts)
- [ ] 13.2 Implement dynamic description generation (list all skills)
- [ ] 13.3 Implement skill loading by name
- [ ] 13.4 Implement namespaced name resolution
- [ ] 13.5 Implement short name resolution with ambiguity detection
- [ ] 13.6 Implement skill content formatting (base directory + content)
- [ ] 13.7 Implement error responses (not found, ambiguous, etc.)
- [ ] 13.8 Write unit tests for skill tool

## 14. MCP Server - Auto-Refresh

- [ ] 14.1 Implement 30-second refresh interval
- [ ] 14.2 Implement skill registry refresh
- [ ] 14.3 Implement tool description update on refresh
- [ ] 14.4 Handle concurrent requests during refresh
- [ ] 14.5 Write unit tests for auto-refresh

## 15. Future Enhancements (Deferred)

<!-- MCP Resources feature is deferred to a future iteration -->
- [ ] 15.1 Consider implementing skill:// resources (see design.md Open Questions)

## 16. Testing Infrastructure

- [ ] 16.1 Create test fixtures (sample SKILL.md files)
- [ ] 16.2 Create mock installed_plugins.json
- [ ] 16.3 Set up test helpers (createTestSkill, etc.)
- [ ] 16.4 Configure coverage reporting (>80% target)
- [ ] 16.5 Set up GitHub Actions for CI (type check, lint, test)

## 17. Integration Testing

- [ ] 17.1 Test CLI commands with real skill directories
- [ ] 17.2 Test MCP server with MCP client (@mastra/mcp or alternative)
- [ ] 17.3 Test plugin discovery with mock plugin directory
- [ ] 17.4 Test priority resolution across all directories
- [ ] 17.5 Test error scenarios (malformed JSON, invalid YAML, etc.)

## 18. Documentation

- [ ] 18.1 Write README.md with installation and usage
- [ ] 18.2 Write README-zh.md (Chinese translation)
- [ ] 18.3 Document CLI commands and flags
- [ ] 18.4 Document MCP integration examples
- [ ] 18.5 Add JSDoc comments to public APIs
- [ ] 18.6 Create CONTRIBUTING.md
- [ ] 18.7 Create CHANGELOG.md

## 19. Build and Distribution

- [ ] 19.1 Configure tsdown to generate ESM and CJS outputs
- [ ] 19.2 Add executable shebang to CLI entry point
- [ ] 19.3 Configure package.json bin field
- [ ] 19.4 Test installation via npm link
- [ ] 19.5 Test npx execution
- [ ] 19.6 Create GitHub release workflow

## 20. Quality Assurance

- [ ] 20.1 Run type checking: pnpm ts
- [ ] 20.2 Run linting: pnpm lint
- [ ] 20.3 Run tests: pnpm test
- [ ] 20.4 Run coverage: pnpm test:coverage (verify >80%)
- [ ] 20.5 Format code: pnpm fmt
- [ ] 20.6 Manual testing with Claude Code plugins
- [ ] 20.7 Manual testing with multiple AI agents (Cursor, Windsurf)

## 21. Final Verification

- [ ] 21.1 Verify ccski list shows all user skills correctly
- [ ] 21.2 Verify ccski list includes plugin skills with namespaces
- [ ] 21.3 Verify ccski info <skill> shows correct content and base directory
- [ ] 21.4 Verify ccski search finds skills accurately
- [ ] 21.5 Verify ccski validate reports errors correctly
- [ ] 21.6 Verify MCP server starts and responds to tool calls
- [ ] 21.7 Verify skill tool description lists all available skills
- [ ] 21.8 Verify skill tool loads skill content correctly
- [ ] 21.9 Verify auto-refresh detects new/modified/deleted skills
- [ ] 21.10 Verify priority resolution works across all directories
- [ ] 21.11 Verify error messages are helpful and actionable
- [ ] 21.12 Verify all test suites pass
