# Change: Add documentation site and GitHub Pages deployment

## Why
- Users need a structured, navigable documentation site for CLI and API usage.
- README should reference canonical docs and keep installation/quick-start concise.
- GitHub Pages provides a low-friction, always-available docs host.

## What Changes
- Add VitePress docs under `docs/` with separate CLI and API sections.
- Update README to point to the docs site and summarize core usage.
- Add GitHub Actions workflow to build and deploy docs to GitHub Pages.

## Impact
- New dependency: VitePress (dev dependency).
- New documentation structure under `docs/`.
- New workflow under `.github/workflows/`.
