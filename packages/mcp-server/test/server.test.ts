import { Session, SessionManager, withProjectEnv } from "@decisions-e2e/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FakeDriver, el, scripted, snap, testConfig } from "../../core/test/helpers.js";
import { createServer } from "../src/server.js";

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];
let manager: SessionManager;
afterEach(() => manager?.closeAll());

async function connect(scripts: Parameters<typeof scripted>[0], env: NodeJS.ProcessEnv = {}) {
  const login = snap([el(1, "textbox", "Email"), el(2, "textbox", "OTP"), el(3, "button", "Log in"), el(4, "link", "Help")]);
  const driver = new FakeDriver(login, (a, d) => {
    if (a.op === "TYPE_TEXT") d.page = snap(d.page.elements.map((e) => (e.index === a.element?.index ? { ...e, value: a.text } : e)), { visibleText: `typed ${a.text}` });
    if (a.op === "CLICK") d.page = snap([el(1, "link", "Logout"), el(2, "link", "Home")], { url: "http://test/home", visibleText: "Welcome" });
  });
  const { client: decisions, requests } = scripted(scripts);
  manager = new SessionManager((o) => new Session(driver, decisions, o?.projectDir ? { ...testConfig(), runsDir: join(o.projectDir, "e2e-runs") } : testConfig(), withProjectEnv(o?.projectDir, env)));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(manager).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const content = r.content as Content;
    return { isError: r.isError, content, text: content[0]!.text!, json: () => JSON.parse(content[0]!.text!) };
  };
  return { client, call, driver, requests };
}

test("liệt kê đủ tool; mô tả e2e_do nhắc phải check", async () => {
  const { client } = await connect([]);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(["e2e_run", "e2e_open", "e2e_do", "e2e_check", "e2e_screenshot", "e2e_snapshot", "e2e_save_test", "e2e_run_test", "e2e_close"]);
  expect(tools.find((t) => t.name === "e2e_do")!.description).toContain("e2e_check");
});

test("open → do → check → snapshot → screenshot → close", async () => {
  const { call, requests } = await connect(
    [
      { operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "email" },
      { operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "otp" },
      { operation: "CLICK", click_target: "3" },
      { operation: "DONE" },
      { check_1: "0.96", check_2: "0.1" },
    ],
    { E2E_SECRET_OTP: "otp-777" },
  );

  const opened = await call("e2e_open", { url: "http://test/" });
  const { session_id } = opened.json();
  expect(opened.json()).toMatchObject({ final_url: "http://test/" });
  expect(opened.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

  const done = await call("e2e_do", { session_id, instruction: "Log in", data: { email: "qa@x.com", otp: "{{OTP}}" } });
  expect(done.json()).toMatchObject({
    status: "done",
    final_url: "http://test/home",
    steps: [
      { step: 1, op: "TYPE_TEXT", element: "Email", value: "qa@x.com", page_changed: true },
      { step: 2, op: "TYPE_TEXT", element: "OTP", value: "{{OTP}}" },
      { step: 3, op: "CLICK", element: "Log in" },
    ],
  });
  expect(done.content[1]!.type).toBe("image");
  // Secret không lọt ra Claude hay OpenAI.
  expect(done.text).not.toContain("otp-777");
  expect(JSON.stringify(requests)).not.toContain("otp-777");

  const check = await call("e2e_check", { session_id, expectations: ["Logged in", "Shows an error"] });
  expect(check.json()).toMatchObject({
    passed: false,
    final_url: "http://test/home",
    results: [{ expectation: "Logged in", passed: true, probability: 0.96 }, { expectation: "Shows an error", passed: false, probability: 0.1 }],
  });

  const snapshot = await call("e2e_snapshot", { session_id });
  expect(snapshot.text).toContain('[1] link "Logout" · ops: CLICK');

  const shot = await call("e2e_screenshot", { session_id, full_page: true });
  expect(shot.json().screenshot).toMatch(/screenshot\.png$/);

  const closed = await call("e2e_close", { session_id });
  expect(closed.json().report).toMatch(/report\.md$/);
  expect((await call("e2e_check", { session_id, expectations: ["x"] })).isError).toBe(true);
});

test("snapshot che secret đang hiện trên trang", async () => {
  const { call } = await connect([{ operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "otp" }, { operation: "DONE" }], { E2E_SECRET_OTP: "otp-777" });
  const { session_id } = (await call("e2e_open", { url: "http://test/" })).json();
  await call("e2e_do", { session_id, instruction: "Type the OTP", data: { otp: "{{OTP}}" } });
  const text = (await call("e2e_snapshot", { session_id })).text;
  expect(text).not.toContain("otp-777");
  expect(text).toContain("***");
});

test("lỗi trả về isError, server không sập", async () => {
  const { call } = await connect([]);
  const bad = await call("e2e_do", { session_id: "nope", instruction: "x" });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain("e2e_open");
});

test("needs_input trả missing_field để Claude hỏi người dùng", async () => {
  const { call, driver } = await connect([{ operation: "TYPE_TEXT", type_text_target: "1" }]);
  const { session_id } = (await call("e2e_open", { url: "http://test/" })).json();
  const r = await call("e2e_do", { session_id, instruction: "Log in" });
  expect(r.json()).toMatchObject({ status: "needs_input", missing_field: { label: "Email", role: "textbox" }, steps: [] });
  expect(driver.acted).toHaveLength(0);
});

test("e2e_run: chạy trọn kịch bản trong một lần gọi, kết quả nằm trong <project_dir>/e2e-runs, không trả ảnh", async () => {
  const project = mkdtempSync(join(tmpdir(), "proj-"));
  const { call } = await connect([
    { operation: "TYPE_TEXT", type_text_target: "1" },
    { value_key: "email" },
    { operation: "CLICK", click_target: "3" },
    { operation: "DONE" },
    { check_1: "0.95" },
  ]);
  const r = await call("e2e_run", {
    project_dir: project,
    url: "http://test/",
    steps: [{ do: "Log in", data: { email: "qa@x.com" }, check: ["Welcome is shown"] }],
  });
  expect(r.content.every((c) => c.type === "text")).toBe(true);
  const out = r.json();
  expect(out).toMatchObject({ passed: true, total_steps: 1, final_url: "http://test/home" });
  expect(out.run_dir.startsWith(join(project, "e2e-runs"))).toBe(true);
  expect(existsSync(out.report)).toBe(true);
  expect(JSON.parse(readFileSync(join(out.run_dir, "result.json"), "utf8")).passed).toBe(true);
});

test("e2e_run: placeholder lấy giá trị từ <project_dir>/.env.e2e", async () => {
  const project = mkdtempSync(join(tmpdir(), "proj-"));
  writeFileSync(join(project, ".env.e2e"), "E2E_SECRET_PROJ_EMAIL=qa@proj.test\n");
  const { call } = await connect([
    { operation: "TYPE_TEXT", type_text_target: "1" },
    { value_key: "email" },
    { operation: "CLICK", click_target: "3" },
    { operation: "DONE" },
    { check_1: "0.95" },
  ]);
  const r = await call("e2e_run", { project_dir: project, url: "http://test/", steps: [{ do: "Log in", data: { email: "{{PROJ_EMAIL}}" }, check: ["Welcome is shown"] }] });
  expect(r.json()).toMatchObject({ passed: true });
  expect(r.content.map((c) => c.text).join("")).not.toContain("qa@proj.test");
});

test("e2e_run: dừng ở bước đầu tiên không đạt, báo bước và lý do", async () => {
  const project = mkdtempSync(join(tmpdir(), "proj-"));
  const { call, driver } = await connect([{ operation: "CLICK", click_target: "3" }, { operation: "DONE" }, { check_1: "0.1" }]);
  const out = (await call("e2e_run", { project_dir: project, url: "http://test/", steps: [{ do: "Log in", check: ["Error banner"] }, { do: "Never runs" }] })).json();
  expect(out).toMatchObject({ passed: false, failed_step: 1 });
  expect(out.reason).toContain("Error banner");
  expect(driver.acted).toHaveLength(1);
});

test("e2e_run: project_dir phải là đường dẫn tuyệt đối", async () => {
  const { call } = await connect([]);
  const r = await call("e2e_run", { project_dir: "relative/dir", url: "http://test/", steps: [{ do: "x" }] });
  expect(r.isError).toBe(true);
});

test("e2e_save_test lưu lệnh đã chạy vào <project_dir>/e2e-tests; e2e_run_test chạy lại cho cùng kết quả", async () => {
  const project = mkdtempSync(join(tmpdir(), "proj-"));
  const script: Record<string, string>[] = [
    { operation: "TYPE_TEXT", type_text_target: "1" },
    { value_key: "email" },
    { operation: "CLICK", click_target: "3" },
    { operation: "DONE" },
    { check_1: "0.95" },
  ];
  const { call, driver } = await connect([...script, ...script]);
  const start = driver.page;
  driver.open = async () => void (driver.page = start); // mở lại = về trang đăng nhập
  const { session_id } = (await call("e2e_open", { url: "http://test/" })).json();
  await call("e2e_do", { session_id, instruction: "Log in", data: { email: "qa@x.com", password: "{{PW}}" } });
  await call("e2e_check", { session_id, expectations: ["Welcome is shown"] });

  const saved = (await call("e2e_save_test", { session_id, project_dir: project, name: "login ok" })).json();
  expect(saved.file).toBe(join(project, "e2e-tests", "login-ok.test.md"));
  const text = readFileSync(saved.file, "utf8");
  expect(text).toContain("## do: Log in\n## check: Welcome is shown");
  expect(text).toContain('password: "{{PW}}"');
  expect((await call("e2e_save_test", { session_id, project_dir: project, name: "login ok" })).isError).toBe(true); // không ghi đè ngầm

  const run = (await call("e2e_run_test", { project_dir: project, file: "e2e-tests/login-ok.test.md" })).json();
  expect(run).toMatchObject({ test: "login ok", passed: true, total_steps: 1 });
  expect(run.run_dir.startsWith(join(project, "e2e-runs"))).toBe(true);
});
