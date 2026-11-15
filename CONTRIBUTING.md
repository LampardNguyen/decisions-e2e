# Contributing to decisions-e2e

Thanks for helping! This guide covers bug reports, local setup, and pull requests.

## Reporting bugs

Open an issue with the **Bug report** template. Include:

- what you ran (tool call, `.test.md` file, or CLI command)
- what you expected and what happened
- `result.json` and the relevant part of `report.md` from the run folder
- Node.js version and OS

**Never paste secrets, API keys, or `trace.json` from real environments without checking it first.** Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

```bash
git clone https://github.com/LampardNguyen/decisions-e2e.git
cd decisions-e2e
npm install
npx playwright install chromium
npm run build
npm test
```

`npm test` runs offline with a fake decision client; no API key is needed. To run against the real API, create `.env` from `.env.example` and use `npm run poc` or `npm run smoke:mcp`.

## Project layout

- `packages/core`: engine (observe → decide → act), checks, sessions, scenarios, `.test.md`
- `packages/driver-playwright`: browser driver and in-page snapshot script
- `packages/mcp-server`: MCP stdio server
- `packages/cli`: `decisions-e2e` command

## Pull requests

1. Fork and create a branch from `main` (`fix/...`, `feat/...`, `docs/...`).
2. Keep changes focused: one topic per PR.
3. Add or update tests for behavior changes. Driver changes usually need an HTML fixture in `packages/driver-playwright/test/fixtures/`.
4. Make sure these pass:
   ```bash
   npm run typecheck
   npm test
   ```
5. Add an entry at the top of `CHANGELOG.md`.
6. Fill in the pull request template.

## Code style

- TypeScript, ES modules, strict mode.
- Match the style of the surrounding code; keep functions small and avoid speculative abstractions.
- Comments explain *why*, not *what*.
- Never log or persist secret values; use the `{{NAME}}` placeholder mechanism.

## Code of conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
