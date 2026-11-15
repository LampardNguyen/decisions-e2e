# decisions-e2e

**English** | [Tiếng Việt](README.vi.md)

Natural-language end-to-end web testing, driven from Claude (MCP) or the command line. You write steps (`do`) and expectations (`check`) in plain language. The tool drives a real browser with Playwright, verifies the result, and returns only PASS/FAIL plus the folder holding the run results. At each step, the OpenAI Decisions API (`/v1/decisions`, model `gpt-6-luna`) picks the action and the target element.

Status: v0.1.0. Core engine, Playwright driver, MCP server, `.test.md` test files and CLI are done.

## Features

- **One-call test runs**: `e2e_run` executes a whole test case and returns a short JSON result, no screenshots, so it costs the chat very few tokens.
- **Plain-language steps**: no selectors. The engine observes the page, chooses an action, acts, and repeats until the goal is reached.
- **iframe-aware**: elements inside nested iframes are listed and clickable; the engine waits for AJAX-loaded frames to settle.
- **Reusable test files**: save an interactive session as `e2e-tests/<name>.test.md` and replay it with `e2e_run_test` or the CLI.
- **Secrets stay local**: write `{{NAME}}` in test data and set `E2E_SECRET_NAME`. Real values are never sent to OpenAI, returned to Claude, or written to traces and test files.
- **Results live in the project under test**: `<project_dir>/e2e-runs/`, not in this repo.

## Requirements

- Node.js ≥ 22.2
- Chromium installed through Playwright
- An OpenAI API key with access to the Decisions API

## Build

```bash
npm install
npx playwright install chromium
npm run build
```

## First-time setup

1. Copy `.env.example` to `.env` at the repo root (or a parent folder) and fill it in:

   ```
   OPENAI_API_KEY=sk-...
   E2E_SECRET_QA_PASSWORD=...
   ```

2. Register the MCP server with Claude Code:

   ```bash
   claude mcp add decisions-e2e -- node /absolute/path/to/decisions-e2e/packages/mcp-server/dist/index.js
   ```

   Or with Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "decisions-e2e": {
         "command": "node",
         "args": ["/absolute/path/to/decisions-e2e/packages/mcp-server/dist/index.js"]
       }
     }
   }
   ```

The server reads `.env` relative to the repo, regardless of the current directory. After rebuilding, start a new Claude session so it loads the new `dist`.

## Usage in chat

Open Claude **in the project you want to test** and send the whole test case at once:

```
Use the e2e_run tool of the decisions-e2e MCP, call it exactly ONCE, project_dir = the current working directory (absolute path).
url: https://staging.example.com/login
steps:
1. do: "Log in with email and password", data: {"email": "qa01@example.com", "password": "{{QA_PASSWORD}}"}, check: ["The header shows the account name"]
2. do: "Search for 'T-shirt' and add the first product to the cart", check: ["The cart contains 1 item"]
Report only PASS/FAIL, the failed step and reason (if any), and run_dir. Do not open screenshots or the report.
```

Result:

```json
{ "passed": false, "failed_step": 2, "reason": "check failed (0.12): The cart contains 1 item", "total_steps": 2, "run_dir": "...", "report": "...", "final_url": "..." }
```

### Tools

| Tool | Purpose | Returns images |
|---|---|---|
| `e2e_run` | Run a whole test case in one call | no |
| `e2e_run_test` | Replay a `.test.md` file | no |
| `e2e_save_test` | Save the session's do/check commands to `<project_dir>/e2e-tests/<name>.test.md` | no |
| `e2e_open` | Open a browser at a URL, return `session_id` (step-by-step debugging) | yes |
| `e2e_do` | Achieve one small goal; the engine loops observe → decide → act | yes |
| `e2e_check` | Judge expectations on the current page, with probabilities | yes |
| `e2e_screenshot` | Screenshot (viewport or full page) | yes |
| `e2e_snapshot` | Debug: the element table the engine sees | no |
| `e2e_close` | Close the browser and write `report.md` | no |

Tips:

- The step-by-step tools return images and cost many tokens. Use them only for debugging, then save with `e2e_save_test`.
- `e2e_do` returning `done` does **not** mean pass. Always confirm with a check.
- Opening a dropdown and choosing an item should be **one** `do`, because dropdowns may close between calls.
- Write checks about what is **visible** on screen (form titles, field values).
- `needs_input`: a field needs a value missing from `data`. `blocked`: CAPTCHA, 2FA, or low confidence.

## Test files (`.test.md`)

```markdown
---
name: login
url: https://staging.example.com/login
data:
  email: qa01@example.com
  password: "{{QA_PASSWORD}}"
---

## do: Log in with email and password
## check: The header shows the account name
```

`data` is shared by every `do`. Each `## check:` belongs to the `## do:` right before it. A run stops at the first failing step.

## CLI

```bash
npx decisions-e2e run e2e-tests/login.test.md
npx decisions-e2e do --url https://staging.example.com --goal "Log in" --data email=qa01@example.com --data "password={{QA_PASSWORD}}" --check "The header shows the account name"
```

`--project-dir` defaults to the current directory. Exit codes: 0 pass, 1 fail, 2 bad arguments.

## Run results

```
<project_dir>/
  e2e-tests/<name>.test.md
  e2e-runs/<time>_<session>/
    result.json    passed, failed step, reason, steps run
    report.md      human-readable summary
    trace.json     every request/decision/probability (secrets masked)
    screenshots/
```

Add `e2e-runs/` to your project's `.gitignore`.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | (required) | |
| `DECISIONS_MODEL` | `gpt-6-luna` | |
| `E2E_MAX_STEPS` | 25 | max actions per `do` |
| `E2E_MAX_ELEMENTS` | 250 | max elements sent to the model |
| `E2E_MIN_CONFIDENCE` | 0.35 | below this → `blocked` |
| `E2E_CHECK_THRESHOLD` | 0.7 | pass threshold for checks |
| `E2E_STEP_SCREENSHOTS` | false | screenshot after every action |
| `E2E_RUNS_DIR` | `<repo>/runs` | used only when no `project_dir` is given |
| `E2E_HEADED` | true | show the browser window |
| `E2E_SECRET_<NAME>` | — | value for `{{NAME}}` |

## Privacy

Page content (visible text, the element list, and screenshots during checks) is sent to OpenAI. Use only test environments and test accounts. A secret typed into a non-password field can still appear in a check screenshot.

## Architecture

```
packages/
  core/               engine: observe → decide → act loop, checks, sessions, scenarios, .test.md parser
  driver-playwright/  browser driver: snapshots of interactive elements across iframes, actions, settle waits
  mcp-server/         MCP stdio server exposing the e2e_* tools
  cli/                decisions-e2e command
```

The engine depends only on a `Driver` interface, so other drivers (e.g. Appium) can be added later.

## Limitations

Not supported yet: file upload, canvas, drag and drop, popups/new tabs, scrolling inside nested scroll areas. After each click the engine waits for the page and child iframes to be quiet for at least 1 s, so steps are slower than manual clicks.

## Development

```bash
npm test            # offline tests, no API key needed
npm run typecheck
npm run poc         # real do/check on local fixtures (needs API key)
npm run smoke:mcp   # real MCP server over stdio on a login fixture
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
