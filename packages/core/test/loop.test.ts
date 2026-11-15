import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { DecisionsError, Session, SessionManager, StalePage } from "../src/index.js";
import { FakeDriver, el, scripted, snap, testConfig } from "./helpers.js";

const login = () => snap([el(1, "textbox", "Email"), el(2, "textbox", "Password"), el(3, "button", "Log in"), el(4, "link", "Help")]);

test("điền form rồi DONE; secret không rời máy", async () => {
  const driver = new FakeDriver(login(), (a, d) => {
    // Trang (giả) hiện giá trị vừa gõ ở visibleText — kể cả secret.
    if (a.op === "TYPE_TEXT") d.page = { ...d.page, visibleText: `${d.page.visibleText} ${a.text}`, fingerprint: `${d.page.fingerprint}+` };
    if (a.op === "CLICK") d.page = snap([el(1, "link", "Logout"), el(2, "link", "Home")], { visibleText: "Welcome" });
  });
  const { client, requests } = scripted([
    { operation: "TYPE_TEXT", type_text_target: "1" },
    { value_key: "email" },
    { operation: "TYPE_TEXT", type_text_target: "2" },
    { value_key: "password" },
    { operation: "CLICK", click_target: "3" },
    { operation: "DONE" },
  ]);
  const session = new Session(driver, client, testConfig(), { E2E_SECRET_PW: "hunter2" });
  const r = await session.do("Log in", { email: "qa@x.com", password: "{{PW}}" });

  expect(r.status).toBe("done");
  expect(driver.acted.map((a) => [a.op, a.element?.label, a.text, a.secret])).toEqual([
    ["TYPE_TEXT", "Email", "qa@x.com", false],
    ["TYPE_TEXT", "Password", "hunter2", true],
    ["CLICK", "Log in", undefined, undefined],
  ]);
  expect(r.steps.map((s) => s.typedValueMasked)).toEqual(["qa@x.com", "{{PW}}", undefined]);
  // Request phụ dùng lại nguyên input của request chính (để trúng cache).
  expect(requests[1]!.input).toEqual(requests[0]!.input);
  // Secret không có trong request nào, kết quả, hay trace.
  expect(JSON.stringify(requests)).not.toContain("hunter2");
  expect(JSON.stringify(r)).not.toContain("hunter2");
  expect(readFileSync(join(session.trace.dir, "trace.json"), "utf8")).not.toContain("hunter2");
  // Request trước khi click: trang đang hiện secret → đã bị thay bằng ***.
  expect(JSON.stringify(requests[4])).toContain("qa@x.com ***");
});

test("StalePage → snapshot lại, quyết định lại, không tính bước", async () => {
  let first = true;
  const driver = new FakeDriver(login(), (_, d) => {
    if (first) {
      first = false;
      throw new StalePage();
    }
    d.page = snap([el(1, "link", "Logout"), el(2, "link", "Home")]);
  });
  const { client } = scripted([{ operation: "CLICK", click_target: "3" }, { operation: "CLICK", click_target: "3" }, { operation: "DONE" }]);
  const r = await new Session(driver, client, testConfig()).do("Log in");
  expect(r.status).toBe("done");
  expect(r.steps).toHaveLength(1);
  expect(driver.acted).toHaveLength(1);
});

test("stale liên tục → blocked", async () => {
  const driver = new FakeDriver(login(), () => {
    throw new StalePage();
  });
  const { client } = scripted(Array.from({ length: 6 }, () => ({ operation: "CLICK", click_target: "3" })));
  const r = await new Session(driver, client, testConfig()).do("Log in");
  expect(r).toMatchObject({ status: "blocked", steps: [] });
});

test("3 bước liên tiếp không đổi trang → blocked", async () => {
  const driver = new FakeDriver(login());
  const { client } = scripted(Array.from({ length: 3 }, () => ({ operation: "CLICK", click_target: "4" })));
  const r = await new Session(driver, client, testConfig()).do("Log in");
  expect(r.status).toBe("blocked");
  expect(r.steps.map((s) => s.pageChanged)).toEqual([false, false, false]);
});

test("điền 3 ô liên tiếp (giá trị form đổi) không bị coi là kẹt", async () => {
  const driver = new FakeDriver(login(), (a, d) => {
    d.page = snap(d.page.elements.map((e) => (e.index === a.element?.index ? { ...e, value: a.text } : e)));
  });
  const { client } = scripted([
    { operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "a" },
    { operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "a" },
    { operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "a" },
    { operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "a" },
    { operation: "DONE" },
  ]);
  // Mỗi lần gõ giá trị khác nhau để trang thật sự đổi.
  let n = 0;
  const orig = driver.onAct;
  driver.onAct = (a, d) => orig({ ...a, text: `v${n++}` }, d);
  const r = await new Session(driver, client, testConfig()).do("Fill", { a: "x" });
  expect(r.status).toBe("done");
  expect(r.steps).toHaveLength(4);
});

test("không có key phù hợp → needs_input, không thao tác", async () => {
  const driver = new FakeDriver(login());
  const a = scripted([{ operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "NONE" }]);
  const r = await new Session(driver, a.client, testConfig()).do("Log in", { keyword: "x" });
  expect(r).toMatchObject({ status: "needs_input", missingField: { label: "Email", role: "textbox" } });

  // Không có data → không cần request phụ.
  const b = scripted([{ operation: "TYPE_TEXT", type_text_target: "1" }]);
  const r2 = await new Session(driver, b.client, testConfig()).do("Log in");
  expect(r2.status).toBe("needs_input");
  expect(driver.acted).toHaveLength(0);
});

test("history giữ theo session: lần do sau thấy bước của lần trước", async () => {
  const driver = new FakeDriver(login(), (a, d) => {
    if (a.op === "TYPE_TEXT") d.page = snap(d.page.elements.map((e) => (e.index === 1 ? { ...e, value: a.text } : e)));
  });
  const { client, requests } = scripted([
    { operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "email" },
    { operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "NONE" },
    { operation: "DONE" },
  ]);
  const session = new Session(driver, client, testConfig());
  expect((await session.do("Log in", { email: "qa@x.com" })).status).toBe("needs_input");
  await session.do("Log in", { email: "qa@x.com" });
  expect(JSON.stringify(requests.at(-1)!.input)).toContain('TYPE_TEXT textbox \\"Email\\" with data key \\"email\\" → page changed');
});

test("confidence thấp → blocked; thiếu secret → error; hết bước → max_steps", async () => {
  const low = scripted([{ operation: "CLICK", click_target: "3", confidence: "0.2" }]);
  expect((await new Session(new FakeDriver(login()), low.client, testConfig()).do("x")).status).toBe("blocked");

  const miss = scripted([{ operation: "TYPE_TEXT", type_text_target: "2" }, { value_key: "password" }]);
  const r = await new Session(new FakeDriver(login()), miss.client, testConfig(), {}).do("x", { password: "{{PW}}" });
  expect(r.status).toBe("error");
  expect(r.message).toContain("E2E_SECRET_PW");

  let n = 0;
  const driver = new FakeDriver(login(), (_, d) => (d.page = { ...d.page, fingerprint: String(n++) }));
  const many = scripted(Array.from({ length: 2 }, () => ({ operation: "CLICK", click_target: "4" })));
  expect((await new Session(driver, many.client, testConfig()).do("x", {}, 2)).status).toBe("max_steps");
});

test("lỗi thao tác (vd. bị che) được ghi vào step và history, không dừng ngay", async () => {
  let n = 0;
  const driver = new FakeDriver(login(), () => {
    if (n++ === 0) throw new Error("Target element is covered");
  });
  const { client, requests } = scripted([{ operation: "CLICK", click_target: "3" }, { operation: "BLOCKED" }]);
  const r = await new Session(driver, client, testConfig()).do("x");
  expect(r.steps[0]).toMatchObject({ error: "Target element is covered", pageChanged: false });
  expect(JSON.stringify(requests[1]!.input)).toContain("FAILED: Target element is covered");
});

test("check: nhiều expectation trong một request, ảnh có nhãn đứng trước", async () => {
  const driver = new FakeDriver(login());
  const { client, requests } = scripted([{ check_1: "0.95", check_2: "0.3" }]);
  const results = await new Session(driver, client, testConfig()).check(["A", "B"]);
  expect(results.map((r) => [r.expectation, r.passed, r.probability])).toEqual([["A", true, 0.95], ["B", false, 0.3]]);
  expect(requests).toHaveLength(1);
  const parts = requests[0]!.input[1]!.content as { type: string }[];
  expect(parts.map((p) => p.type)).toEqual(["input_json", "input_text", "input_image"]);
});

test("SessionManager: session lạ báo lỗi rõ; session nhàn rỗi quá hạn tự đóng", async () => {
  const drivers: FakeDriver[] = [];
  const manager = new SessionManager(() => {
    const d = new FakeDriver(login());
    drivers.push(d);
    return new Session(d, scripted([]).client, testConfig());
  }, 1000);
  // Thời gian giả để test không phụ thuộc tốc độ máy.
  vi.useFakeTimers();
  try {
    vi.setSystemTime(10_000);
    const a = manager.add();
    const b = manager.add();
    expect(() => manager.get("nope")).toThrow(/e2e_open/);

    let closed = 0;
    for (const d of drivers) d.close = async () => void closed++;
    vi.setSystemTime(10_600);
    await manager.sweep();
    expect(closed).toBe(0);
    manager.get(a.id); // a vừa được dùng ở 10.600
    vi.setSystemTime(11_000); // b nhàn rỗi đủ 1.000 ms, a mới 400 ms
    await manager.sweep();
    expect(() => manager.get(b.id)).toThrow();
    expect(manager.get(a.id)).toBe(a);
    await manager.closeAll();
    expect(closed).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("refusal ở câu target KHÔNG dùng tới bị bỏ qua (form trống: click_target bị từ chối, op là TYPE_TEXT)", async () => {
  const driver = new FakeDriver(login(), (a, d) => {
    d.page = snap(d.page.elements.map((e) => (e.index === a.element?.index ? { ...e, value: a.text } : e)));
  });
  const { client } = scripted([
    { operation: "TYPE_TEXT", type_text_target: "1", click_target: "REFUSAL" },
    { value_key: "email" },
    { operation: "DONE", click_target: "REFUSAL" },
  ]);
  const r = await new Session(driver, client, testConfig()).do("Log in", { email: "qa@x.com" });
  expect(r.status).toBe("done");
  expect(driver.acted.map((a) => [a.op, a.element?.label])).toEqual([["TYPE_TEXT", "Email"]]);
});

test("refusal ở câu CẦN dùng → error, không thao tác, request lỗi có trong trace", async () => {
  const scripts: Record<string, string>[][] = [
    [{ operation: "REFUSAL" }],
    [{ operation: "CLICK", click_target: "REFUSAL" }],
    [{ operation: "TYPE_TEXT", type_text_target: "1" }, { value_key: "REFUSAL" }],
  ];
  for (const script of scripts) {
    const driver = new FakeDriver(login());
    const session = new Session(driver, scripted(script).client, testConfig());
    const r = await session.do("Log in", { email: "qa@x.com" });
    expect(r.status).toBe("error");
    expect(r.message).toContain("từ chối");
    expect(driver.acted).toHaveLength(0);
  }

  // Lỗi từ chính API (mạng, 4xx...) cũng được ghi vào trace kèm request.
  const failing = { ask: async () => { throw new DecisionsError("HTTP 500"); } };
  const session = new Session(new FakeDriver(login()), failing, testConfig());
  expect((await session.do("Log in")).status).toBe("error");
  const trace = JSON.parse(readFileSync(join(session.trace.dir, "trace.json"), "utf8"));
  expect(trace.find((e: { type: string }) => e.type === "request_error")).toMatchObject({ error: expect.stringContaining("HTTP 500"), questions: expect.any(Array) });
});

test("check: expectation bị model từ chối → lỗi rõ ràng thay vì âm thầm coi là fail", async () => {
  const { client } = scripted([{ check_1: "REFUSAL" }]);
  await expect(new Session(new FakeDriver(login()), client, testConfig()).check(["A"])).rejects.toThrow(/từ chối/);
});

test("bật/tắt qua lại cùng một nút → blocked sớm, lịch sử ghi rõ trang quay lại trạng thái cũ", async () => {
  const closed = snap([el(1, "clickable", "(toggle)"), el(2, "link", "Home")]);
  const open = snap([el(1, "clickable", "(toggle)"), el(2, "link", "Home"), el(3, "link", "Coupons")]);
  const driver = new FakeDriver(closed, (_, d) => (d.page = d.page === closed ? open : closed));
  const { client, requests } = scripted(Array.from({ length: 10 }, () => ({ operation: "CLICK", click_target: "1" })));
  const r = await new Session(driver, client, testConfig()).do("Open the menu");

  expect(r.status).toBe("blocked");
  expect(r.message).toContain("(toggle)");
  expect(r.steps).toHaveLength(4); // đóng→mở→đóng→mở→đóng: trạng thái đóng gặp lần thứ 3
  const lastInput = JSON.stringify(requests.at(-1)!.input);
  expect(lastInput).toContain("page changed (2 → 3 elements)");
  expect(lastInput).toContain("page went BACK to a state seen before");
});

test("thao tác chỉ làm đổi text hiển thị (element giữ nguyên) KHÔNG bị coi là quay lại trạng thái cũ", async () => {
  const form = () => [el(1, "button", "Pay"), el(2, "link", "Help")];
  const driver = new FakeDriver(snap(form()), (_, d) => (d.page = snap(form(), { visibleText: "Payment complete" })));
  const { client, requests } = scripted([{ operation: "CLICK", click_target: "1" }, { operation: "DONE" }]);
  const r = await new Session(driver, client, testConfig()).do("Pay");
  expect(r.status).toBe("done");
  expect(driver.acted).toHaveLength(1);
  const user = requests.at(-1)!.input[1]!.content as unknown as { data: { recent_actions: string[] } }[];
  expect(user[0]!.data.recent_actions).toEqual(['CLICK button "Pay" → page changed (2 → 2 elements)']);
});
