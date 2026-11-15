# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (private vulnerability reporting).
3. Describe the issue, affected versions, and steps to reproduce.

You should get a response within 7 days. Once a fix is ready, we will publish an advisory and credit you unless you prefer otherwise.

## Scope

Especially relevant for this project:

- leaks of `E2E_SECRET_*` values or `OPENAI_API_KEY` into traces, reports, test files, MCP responses, or requests to OpenAI
- path traversal through `project_dir`, test file names, or run folders
- the engine acting outside the requested scope (e.g. following instructions embedded in a tested page)

## Data handling note

Page content and screenshots are sent to OpenAI by design. Use test environments and test accounts only.
