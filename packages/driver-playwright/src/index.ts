import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  StalePage,
  type ContextInfo,
  type Driver,
  type DriverAction,
  type Element,
  type ElementOption,
  type Snapshot,
  type TargetOp,
} from "@decisions-e2e/core";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { actOnElement, scroll } from "./act.js";
import { visibleFrames } from "./frames.js";

// Script chạy trong trang; nằm ngoài src/ để cùng một đường dẫn dùng được từ cả src/ và dist/.
const SNAPSHOT_SCRIPT = readFileSync(new URL("../page/snapshot.js", import.meta.url), "utf8");

interface RawElement extends Omit<Element, "index" | "contextPath" | "ref" | "ops"> {
  id: number;
  ops: TargetOp[];
  inViewport: boolean;
  options?: ElementOption[];
}

export class PlaywrightDriver implements Driver {
  private browser?: Browser;
  private page?: Page;
  private frameKeys = new Map<Frame, string>();
  private framesByKey = new Map<string, Frame>();
  private maxElements: number;

  constructor(opts: { maxElements?: number } = {}) {
    this.maxElements = opts.maxElements ?? 250;
  }

  private get p(): Page {
    if (!this.page) throw new Error("Chưa mở trang (gọi open trước)");
    return this.page;
  }

  async open(url: string, opts: { headed: boolean; viewport?: { width: number; height: number } }): Promise<void> {
    this.browser = await chromium.launch({ headless: !opts.headed });
    const context = await this.browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 } });
    this.page = await context.newPage();
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.waitForSettle("after_click");
  }

  async contexts(): Promise<ContextInfo[]> {
    return (await visibleFrames(this.p)).map(({ frame, path }) => ({
      path,
      kind: path.length === 1 ? "page" : "frame",
      url: frame.url(),
    }));
  }

  private keyOf(frame: Frame): string {
    let key = this.frameKeys.get(frame);
    if (!key) {
      key = `f${this.frameKeys.size}`;
      this.frameKeys.set(frame, key);
      this.framesByKey.set(key, frame);
    }
    return key;
  }

  async snapshot(): Promise<Snapshot> {
    const page = this.p;
    const all: (Omit<Element, "index"> & { inViewport: boolean })[] = [];
    const texts: string[] = [];
    for (const { frame, path } of await visibleFrames(page)) {
      // Frame đang điều hướng có thể ném lỗi: bỏ qua, lần snapshot sau sẽ có.
      const raw = await frame
        .evaluate<{ elements: RawElement[]; text: string }>(`${SNAPSHOT_SCRIPT}\nwindow.__de2e.snapshot()`)
        .catch(() => null);
      if (!raw) continue;
      const key = this.keyOf(frame);
      for (const { id, ...rest } of raw.elements) all.push({ ...rest, contextPath: path, ref: `${key}:${id}` });
      if (raw.text) texts.push(raw.text);
    }

    // Vượt giới hạn: giữ element trong viewport trước, vẫn theo thứ tự DOM.
    const truncated = all.length > this.maxElements;
    let kept = all;
    if (truncated) {
      const order = all.map((e, i) => ({ e, i })).sort((a, b) => Number(b.e.inViewport) - Number(a.e.inViewport) || a.i - b.i);
      kept = order.slice(0, this.maxElements).sort((a, b) => a.i - b.i).map((x) => x.e);
    }
    const elements: Element[] = kept.map(({ inViewport: _, ...e }, i) => ({ index: i + 1, ...e }));

    const url = page.url();
    const semantic = elements.map((e) => [e.contextPath, e.role, e.label, e.value, e.checked, e.selected, e.expanded, e.disabled, e.options?.map((o) => o.label)]);
    return {
      id: randomUUID(),
      url,
      title: await page.title().catch(() => ""),
      visibleText: texts.join("\n").slice(0, 6000),
      elements,
      truncated,
      fingerprint: createHash("sha1").update(JSON.stringify([url, semantic])).digest("hex"),
      takenAt: Date.now(),
    };
  }

  async debugUnlisted(): Promise<string> {
    const lines: string[] = [];
    for (const { frame, path } of await visibleFrames(this.p)) {
      const items = await frame
        .evaluate<{ text: string; chain: string[] }[]>(`${SNAPSHOT_SCRIPT}\nwindow.__de2e.unlisted(60)`)
        .catch(() => []);
      for (const item of items) lines.push(`"${item.text}" in ${path.join(" > ")}\n    ${item.chain.join("\n    < ")}`);
    }
    return lines.join("\n");
  }

  async isFresh(s: Snapshot): Promise<boolean> {
    return (await this.snapshot()).fingerprint === s.fingerprint;
  }

  async act(action: DriverAction, s: Snapshot): Promise<void> {
    const page = this.p;
    if (action.op === "WAIT") return page.waitForTimeout(300);
    if (action.op === "SCROLL_DOWN") return scroll(page, "down");
    if (action.op === "SCROLL_UP") return scroll(page, "up");

    if (!action.element) throw new Error(`Thao tác ${action.op} cần element`);
    if (!(await this.isFresh(s))) throw new StalePage();
    const [key, id] = action.element.ref.split(":");
    const frame = this.framesByKey.get(key!);
    if (!frame || frame.isDetached()) throw new StalePage();
    await actOnElement(frame, Number(id), action);
  }

  async waitForSettle(kind: "after_click" | "after_type" | "explicit"): Promise<void> {
    const page = this.p;
    if (kind === "after_click") {
      // Điều hướng có thể bắt đầu trễ một nhịp sau click.
      await page.waitForTimeout(150);
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      // Iframe con (vd. iframe[main] của trang admin thật) tải lại sau click: chờ từng frame và AJAX đổ dữ liệu.
      await Promise.all(page.frames().map((f) => f.waitForLoadState("load", { timeout: 5000 }).catch(() => {})));
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await this.waitForStableDom(5000);
    } else {
      // after_type: chờ suggestion của combobox xuất hiện.
      await page.waitForTimeout(300);
    }
  }

  /**
   * Chờ đến khi snapshot không đổi suốt QUIET_MS và không iframe hiển thị nào còn trống
   * (iframe vừa điều hướng, chưa có nội dung). Hết `timeoutMs` thì thôi, không ném lỗi.
   */
  private async waitForStableDom(timeoutMs: number): Promise<void> {
    const page = this.p;
    const deadline = Date.now() + timeoutMs;
    // Spinner/"Loading…" có thể đứng yên vài trăm ms trước khi AJAX đổ dữ liệu: cần yên lặng đủ lâu.
    const QUIET_MS = 1000;
    let prev = "";
    let since = Date.now();
    while (Date.now() < deadline) {
      const s = await this.snapshot();
      const state = s.fingerprint + s.visibleText;
      const empty = await Promise.all(
        (await visibleFrames(page)).map(({ frame }) =>
          frame.evaluate(() => !document.body || document.body.innerText.trim() === "").catch(() => true),
        ),
      );
      if (state !== prev || empty.some(Boolean)) {
        prev = state;
        since = Date.now();
      } else if (Date.now() - since >= QUIET_MS) return;
      await page.waitForTimeout(250);
    }
  }

  async screenshot(path: string, opts: { fullPage?: boolean } = {}): Promise<void> {
    await this.p.screenshot({ path, fullPage: opts.fullPage });
  }

  async currentUrl(): Promise<string | null> {
    return this.page?.url() ?? null;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }
}
