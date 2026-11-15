#!/usr/bin/env node
// CLI: chạy test không cần Claude.
//   decisions-e2e run <file.test.md> [--project-dir <dir>] [--headed] [--threshold <0-1>]
//   decisions-e2e do --url <url> --goal <mục tiêu> [--data key=value]... [--check <kỳ vọng>]... [--project-dir <dir>] [--headed]
// Bí mật {{NAME}} đọc thêm từ <project-dir>/.env.e2e (ghi đè .env của repo).
// Kết quả ghi vào <project-dir>/e2e-runs/ (mặc định project-dir = thư mục hiện tại). Exit code 0 = pass, 1 = fail, 2 = sai tham số.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Session, createDecisionsClient, loadConfig, parseTestFile, withProjectEnv, runScenario, stepsOf, type ScenarioStep } from "@decisions-e2e/core";
import { PlaywrightDriver } from "@decisions-e2e/driver-playwright";

const USAGE = `Cách dùng:
  decisions-e2e run <file.test.md> [--project-dir <dir>] [--headed] [--threshold <0-1>]
  decisions-e2e do --url <url> --goal <mục tiêu> [--data key=value]... [--check <kỳ vọng>]... [--project-dir <dir>] [--headed]`;

// .env của repo decisions-e2e (packages/cli/dist → lên 3 cấp), giống MCP server.
const repo = fileURLToPath(new URL("../../../", import.meta.url));
for (const p of [`${repo}.env`, `${repo}../.env`]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        "project-dir": { type: "string" },
        headed: { type: "boolean" },
        threshold: { type: "string" },
        url: { type: "string" },
        goal: { type: "string" },
        data: { type: "string", multiple: true },
        check: { type: "string", multiple: true },
      },
    });
  } catch (e) {
    fail((e as Error).message);
  }
})();

const [command, file] = positionals;
const projectDir = resolve(values["project-dir"] ?? process.cwd());
const threshold = values.threshold === undefined ? undefined : Number(values.threshold);
if (threshold !== undefined && !(threshold >= 0 && threshold <= 1)) fail("--threshold phải trong khoảng 0–1");

let url: string;
let steps: ScenarioStep[];
let name: string | undefined;
if (command === "run") {
  if (!file) fail("Thiếu đường dẫn file .test.md");
  const test = parseTestFile(readFileSync(resolve(file), "utf8"));
  ({ url, name } = test);
  steps = stepsOf(test);
} else if (command === "do") {
  if (!values.url || !values.goal) fail("Lệnh do cần --url và --goal");
  const data: Record<string, string> = {};
  for (const kv of values.data ?? []) {
    const i = kv.indexOf("=");
    if (i <= 0) fail(`--data phải có dạng key=value: ${kv}`);
    data[kv.slice(0, i)] = kv.slice(i + 1);
  }
  url = values.url;
  steps = [{ do: values.goal, ...(Object.keys(data).length && { data }), ...(values.check?.length && { check: values.check }) }];
} else {
  fail(command ? `Lệnh không hợp lệ: ${command}` : "Thiếu lệnh");
}

const config = { ...loadConfig(), runsDir: join(projectDir, "e2e-runs") };
const session = new Session(new PlaywrightDriver({ maxElements: config.maxElements }), createDecisionsClient({ apiKey: config.apiKey, model: config.model }), config, withProjectEnv(projectDir));
const result = await runScenario(session, url, steps, { headed: values.headed, threshold });
console.log(JSON.stringify({ ...(name && { test: name }), ...result }, null, 2));
process.exit(result.passed ? 0 : 1);
