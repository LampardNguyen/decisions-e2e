#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session, SessionManager, createDecisionsClient, loadConfig, withProjectEnv } from "@decisions-e2e/core";
import { PlaywrightDriver } from "@decisions-e2e/driver-playwright";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// Thư mục repo (packages/mcp-server/dist → lên 3 cấp). Server được Claude khởi chạy với cwd bất kỳ,
// nên .env và runs/ được định vị theo repo, không theo cwd.
const repo = fileURLToPath(new URL("../../../", import.meta.url));
for (const p of [`${repo}.env`, `${repo}../.env`]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}
process.env.E2E_RUNS_DIR ||= `${repo}runs`;

const config = loadConfig();
const decisions = createDecisionsClient({ apiKey: config.apiKey, model: config.model });
const sessions = new SessionManager(
  (opts) =>
    new Session(
      new PlaywrightDriver({ maxElements: config.maxElements }),
      decisions,
      opts?.projectDir ? { ...config, runsDir: join(opts.projectDir, "e2e-runs") } : config,
      withProjectEnv(opts?.projectDir),
    ),
);

const server = createServer(sessions);
const transport = new StdioServerTransport();

const shutdown = async () => {
  await sessions.closeAll();
  process.exit(0);
};
transport.onclose = () => void shutdown();
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await server.connect(transport);
console.error("[decisions-e2e] MCP server sẵn sàng (stdio)");
