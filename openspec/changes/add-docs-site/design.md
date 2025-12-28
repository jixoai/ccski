# Design

## Context
We need a public documentation site for CLI and API usage and an automated deployment to GitHub Pages.

## Goals / Non-Goals
- Goals:
  - VitePress site under `docs/` with CLI and API sections.
  - Auto-deploy to GitHub Pages on main branch updates.
  - Keep README concise with pointers to docs.
- Non-Goals:
  - No multi-language docs in this iteration.
  - No complex theming or custom plugins.

## Decisions
- Use VitePress (official) for docs.
- Use GitHub Actions + `actions/deploy-pages` for deployment.
- Base URL set to `/<repo>` for GitHub Pages.

## Risks / Trade-offs
- Pages base path must match repo name; incorrect base breaks asset paths.
- Requires GitHub Pages settings to use GitHub Actions.

## Migration Plan
- Add VitePress config and pages.
- Update README and scripts.
- Add workflow and validate.

## Open Questions
- Confirm repo name for GitHub Pages base (defaults to `ccski`).
