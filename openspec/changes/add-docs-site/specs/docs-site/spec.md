# Capability: Documentation Site

## ADDED Requirements

### Requirement: VitePress site
The project SHALL include a VitePress documentation site under `docs/`.

#### Scenario: site structure
- **WHEN** building docs
- **THEN** the site includes dedicated CLI and API documentation sections.

### Requirement: README links
The README MUST reference the documentation site and summarize how to access CLI and API docs.

#### Scenario: docs link
- **WHEN** viewing README
- **THEN** a link to the docs site is visible and points to the GitHub Pages URL.

### Requirement: GitHub Pages deployment
The project SHALL provide a GitHub Actions workflow to build and deploy the VitePress site to GitHub Pages.

#### Scenario: deploy on main
- **WHEN** commits land on the default branch
- **THEN** the docs build and deploy pipeline runs automatically.
