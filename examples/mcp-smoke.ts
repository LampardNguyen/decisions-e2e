// Kiểm tra MCP server THẬT qua stdio (như Claude gọi): open → do → check → close trên fixture login.
// Gọi Decisions API thật. Chạy: npm run smoke:mcp
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serveFixtures } from "../packages/driver-playwright/test/server.js";

const fixtures = await serveFixtures();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["packages/mcp-server/dist/index.js"],
  env: { ...(process.env as Record<string, string>), E2E_HEADED: "false", E2E_SECRET_QA_PASSWORD: "s3cret-pw" },
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown>) {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text?: string; data?: string }[];
  const image = content.find((c) => c.type === "image");
  console.log(`\n### ${name} (${Math.round(performance.now() - t0)} ms)${r.isError ? " — ERROR" : ""}${image ? ` — kèm ảnh PNG ${Math.round((image.data!.length * 3) / 4 / 1024)} KB` : ""}`);
  console.log(content[0]!.text);
  return r.isError ? {} : JSON.parse(content[0]!.text!.startsWith("{") ? content[0]!.text! : "{}");
}

try {
  console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
  const { session_id } = await call("e2e_open", { url: `${fixtures.origin}/login.html` });
  await call("e2e_snapshot", { session_id });
  const done = await call("e2e_do", { session_id, instruction: "Đăng nhập bằng tài khoản QA", data: { email: "qa@example.com", password: "{{QA_PASSWORD}}" } });
  const check = await call("e2e_check", { session_id, expectations: ["Trang hiển thị lời chào Welcome kèm email qa@example.com", "Trang hiển thị form đăng nhập"] });
  await call("e2e_close", { session_id });
  const ok = done.status === "done" && check.results?.[0]?.passed === true && check.results?.[1]?.passed === false;
  console.log(`\nKẾT QUẢ: ${ok ? "OK" : "KHÔNG ĐẠT"}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  await client.close();
  await fixtures.close();
}
