import { Occluded, StalePage, type Element, type Snapshot } from "@decisions-e2e/core";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { PlaywrightDriver } from "../src/index.js";
import { serveFixtures } from "./server.js";

let a: Awaited<ReturnType<typeof serveFixtures>>;
let b: Awaited<ReturnType<typeof serveFixtures>>;
let driver: PlaywrightDriver;

beforeAll(async () => {
  [a, b] = await Promise.all([serveFixtures(), serveFixtures()]);
});
afterAll(() => Promise.all([a.close(), b.close()]));
afterEach(() => driver?.close());

async function open(path: string, opts = {}) {
  driver = new PlaywrightDriver(opts);
  await driver.open(`${a.origin}/${path}`, { headed: false });
  return driver.snapshot();
}
const find = (s: Snapshot, label: string): Element => {
  const e = s.elements.find((e) => e.label === label);
  if (!e) throw new Error(`Không thấy element "${label}" trong: ${s.elements.map((e) => e.label).join(", ")}`);
  return e;
};
/** Thao tác trên snapshot mới nhất, trả về snapshot sau đó. */
async function act(op: "CLICK" | "TYPE_TEXT" | "SELECT" | "PRESS_ENTER", label: string, extra: { text?: string; optionIndex?: string; secret?: boolean } = {}) {
  const s = await driver.snapshot();
  await driver.act({ op, element: find(s, label), ...extra }, s);
  await driver.waitForSettle(op === "CLICK" ? "after_click" : "after_type");
  return driver.snapshot();
}

test("snapshot: index liên tục, role, label, ops", async () => {
  const s = await open("login.html");
  expect(s.elements.map((e) => e.index)).toEqual(s.elements.map((_, i) => i + 1));
  expect(s.elements.map((e) => [e.role, e.label, e.ops])).toEqual([
    ["textbox", "Email", ["TYPE_TEXT", "PRESS_ENTER"]],
    ["textbox", "Password", ["TYPE_TEXT", "PRESS_ENTER"]],
    ["checkbox", "Remember me", ["CLICK"]], // checkbox KHÔNG editable
    ["button", "Log in", ["CLICK"]],
    ["button", "Single sign-on", []],
    ["link", "Forgot password?", ["CLICK"]],
  ]);
  expect(find(s, "Single sign-on").disabled).toBe(true);
  expect(find(s, "Remember me").checked).toBe(false);
  expect(s.elements.every((e) => e.contextPath.join() === "main")).toBe(true);
  expect(s.title).toBe("Login fixture");
  expect(s.visibleText).toContain("Sign in");
});

test("đăng nhập: gõ, click, trang đổi; không bao giờ lộ giá trị password", async () => {
  await open("login.html");
  await act("TYPE_TEXT", "Email", { text: "wrong" });
  let s = await act("TYPE_TEXT", "Email", { text: "qa@example.com" }); // thay thế nội dung cũ
  expect(find(s, "Email").value).toBe("qa@example.com");
  expect(find(s, "Password").value).toBe("<empty>");
  s = await act("TYPE_TEXT", "Password", { text: "s3cret-pw" });
  expect(find(s, "Password").value).toBe("<filled>");
  expect(JSON.stringify(s)).not.toContain("s3cret-pw");
  s = await act("CLICK", "Remember me");
  expect(find(s, "Remember me").checked).toBe(true);
  s = await act("PRESS_ENTER", "Password");
  expect(s.visibleText).toContain("Welcome, qa@example.com");
  expect(s.url).toBe(`${a.origin}/home`);
});

test("secret gõ vào ô không phải password cũng bị che trong snapshot sau", async () => {
  await open("login.html");
  const s = await act("TYPE_TEXT", "Email", { text: "otp-123456", secret: true });
  expect(find(s, "Email").value).toBe("<filled>");
  expect(JSON.stringify(s)).not.toContain("otp-123456");
});

test("select native, radio, combobox autocomplete", async () => {
  let s = await open("controls.html");
  const country = find(s, "Country");
  expect(country).toMatchObject({ role: "select", ops: ["SELECT"], value: "Choose…" });
  expect(country.options?.map((o) => [o.index, o.label])).toEqual([["0", "Choose…"], ["1", "Vietnam"], ["2", "Japan"], ["3", "United States"]]);
  expect(find(s, "City")).toMatchObject({ role: "combobox", expanded: false, ops: ["TYPE_TEXT", "PRESS_ENTER", "CLICK"] });

  s = await act("SELECT", "Country", { optionIndex: "2" });
  expect(find(s, "Country").value).toBe("Japan");
  s = await act("CLICK", "Express delivery");
  expect(find(s, "Express delivery").checked).toBe(true);
  expect(find(s, "Standard delivery").checked).toBe(false);

  s = await act("TYPE_TEXT", "City", { text: "h" });
  expect(s.elements.filter((e) => e.role === "option").map((e) => e.label)).toEqual(["Hanoi", "Ho Chi Minh City", "Hue"]);
  expect(find(s, "City").expanded).toBe(true);
  await act("CLICK", "Hue");
  s = await act("CLICK", "Save");
  expect(s.visibleText).toContain("Saved: country=jp speed=exp city=Hue");
});

test("iframe cùng origin và khác origin: context, thao tác đúng frame", async () => {
  let s = await open(`checkout.html?card=${encodeURIComponent(b.origin)}`);
  expect((await driver.contexts()).map((c) => [c.path, c.kind])).toEqual([
    [["main"], "page"],
    [["main", "iframe[note]"], "frame"],
    [["main", "iframe[payment]"], "frame"],
  ]); // iframe display:none bị bỏ
  expect(s.elements.map((e) => [e.index, e.label, e.contextPath.join(" > ")])).toEqual([
    [1, "Full name", "main"],
    [2, "Pay now", "main"],
    [3, "Order note", "main > iframe[note]"],
    [4, "Card number", "main > iframe[payment]"],
  ]);
  expect(s.visibleText).toContain("Order note");
  expect(s.visibleText).toContain("Card number");

  await act("TYPE_TEXT", "Full name", { text: "Linh" });
  await act("TYPE_TEXT", "Order note", { text: "Leave at door" });
  await act("TYPE_TEXT", "Card number", { text: "4242424242424242" });
  s = await act("CLICK", "Pay now");
  expect(s.visibleText).toContain("Payment complete for Linh (card ending 4242, note: Leave at door)");
});

test("element bị che → Occluded, không click", async () => {
  let s = await open("occluded.html");
  await expect(driver.act({ op: "CLICK", element: find(s, "Buy") }, s)).rejects.toThrow(Occluded);
  expect((await driver.snapshot()).visibleText).not.toContain("Bought");
  await act("CLICK", "Close banner");
  s = await act("CLICK", "Buy");
  expect(s.visibleText).toContain("Bought");
});

test("snapshot cũ → StalePage, không thao tác", async () => {
  const old = await open("login.html");
  await act("TYPE_TEXT", "Email", { text: "changed" });
  expect(await driver.isFresh(old)).toBe(false);
  await expect(driver.act({ op: "CLICK", element: find(old, "Log in") }, old)).rejects.toThrow(StalePage);
  expect((await driver.snapshot()).visibleText).not.toContain("Invalid");
});

test("pointer div, shadow DOM, element ẩn/xa, file input, nearText cho nhãn trùng", async () => {
  let s = await open("misc.html");
  expect(s.elements.map((e) => e.label)).toEqual(["Open menu", "Shadow action", "Upload", "PIN", "Add to cart", "Add to cart"]);
  expect(find(s, "Open menu")).toMatchObject({ role: "clickable", ops: ["CLICK"] });
  expect(find(s, "Upload").ops).toEqual([]);
  expect(find(s, "PIN").value).toBe("<filled>");
  expect(s.elements.filter((e) => e.label === "Add to cart").map((e) => e.nearText)).toEqual(["Blue shirt Add to cart", "Red hat Add to cart"]);
  expect(find(s, "Open menu").nearText).toBeUndefined();

  s = await act("CLICK", "Open menu");
  expect(s.visibleText).toContain("Menu opened");
  s = await act("CLICK", "Shadow action");
  expect(s.visibleText).toContain("Shadow clicked");
});

test("vượt maxElements → truncated", async () => {
  const s = await open("login.html", { maxElements: 3 });
  expect(s.truncated).toBe(true);
  expect(s.elements.map((e) => e.index)).toEqual([1, 2, 3]);
});

test("scroll đổi phần text nhìn thấy", async () => {
  const s = await open("misc.html");
  expect(s.elements.some((e) => e.label === "Far below")).toBe(false);
  for (let i = 0; i < 7; i++) await driver.act({ op: "SCROLL_DOWN" }, s);
  await driver.waitForSettle("explicit");
  expect((await driver.snapshot()).elements.some((e) => e.label === "Far below")).toBe(true);
});

test("nút chỉ có icon nhận gợi ý nhãn trong ngoặc; debugUnlisted chỉ ra mục menu bị bỏ sót", async () => {
  let s = await open("menu.html");
  expect(s.elements.map((e) => [e.role, e.label])).toEqual([
    ["link", "Top"],
    ["link", "Settings"], // <a> không href, listener gắn bằng JS (menu trái của trang admin thật)
    ["clickable", "(tog toggle sidebar-toggle icon-hamburger)"],
    ["button", "Close panel"], // <svg><title> là nhãn thật, không cần gợi ý
  ]);
  s = await act("CLICK", "(tog toggle sidebar-toggle icon-hamburger)");
  expect(s.elements.some((e) => e.label === "Coupon list")).toBe(true);

  s = await act("CLICK", "Settings");
  expect(s.visibleText).toContain("Settings clicked");

  // Mục menu là <div> không có href/role/cursor → không vào bảng, nhưng debug chỉ ra nó cùng dấu hiệu DOM.
  const debug = await driver.debugUnlisted();
  expect(debug).toContain('"Content" in main');
  expect(debug).toContain("div#content.rail-item [cursor=auto]");
  expect(debug).toContain("nav.rail");
  expect(debug).not.toContain('"Top"');
});

test("dropdown: <li role=menuitem> bọc đúng một <a> cùng nhãn → chỉ liệt kê <a>, click trúng handler", async () => {
  const s = await open("dropdown.html");
  expect(s.elements.map((e) => [e.role, e.label])).toEqual([
    ["link", "Duplicate"],
    ["link", "Stop"],
  ]);
  const after = await act("CLICK", "Duplicate");
  expect(after.visibleText).toContain("dup clicked");
});

test("waitForSettle: chờ iframe con điều hướng và đổ nội dung trễ", async () => {
  await open("slow-frame.html");
  const s = await act("CLICK", "Open list");
  expect(s.visibleText).toContain("Coupon A");
  expect(s.elements.some((e) => e.label === "Edit")).toBe(true);
});
