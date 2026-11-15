import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Answer,
  type Config,
  type DecisionsClient,
  type DecisionsRequest,
  type Driver,
  type DriverAction,
  type Element,
  type Snapshot,
  loadConfig,
} from "../src/index.js";

export function el(index: number, role: string, label: string, extra: Partial<Element> = {}): Element {
  const editable = role === "textbox";
  return {
    index,
    role,
    label,
    ops: role === "select" ? ["SELECT"] : editable ? ["TYPE_TEXT", "PRESS_ENTER"] : ["CLICK"],
    contextPath: ["main"],
    ref: `f0:${index}`,
    ...extra,
  };
}

export function snap(elements: Element[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "s",
    url: "http://test/",
    title: "Test",
    visibleText: "",
    elements,
    truncated: false,
    fingerprint: JSON.stringify(elements.map((e) => [e.role, e.label, e.value, e.checked])),
    takenAt: 0,
    ...extra,
  };
}

/** Driver giả: `page` là trạng thái hiện tại; `onAct` cho phép test đổi trang hoặc ném lỗi. */
export class FakeDriver implements Driver {
  acted: DriverAction[] = [];
  snapshots = 0;
  constructor(
    public page: Snapshot,
    public onAct: (a: DriverAction, d: FakeDriver) => void = () => {},
  ) {}
  async open() {}
  async contexts() {
    return [];
  }
  async snapshot() {
    this.snapshots++;
    return this.page;
  }
  async isFresh(s: Snapshot) {
    return s.fingerprint === this.page.fingerprint;
  }
  async act(a: DriverAction) {
    this.onAct(a, this);
    this.acted.push(a);
  }
  async waitForSettle() {}
  async screenshot(path: string) {
    writeFileSync(path, "fake-png");
  }
  async currentUrl() {
    return this.page.url;
  }
  async close() {}
}

/** Client giả: mỗi request lấy một kịch bản `{ tên câu hỏi: choice }`; câu không có trong kịch bản lấy choice đầu; "REFUSAL" = model từ chối câu đó. */
export function scripted(scripts: (Record<string, string> & { confidence?: string })[]) {
  const requests: DecisionsRequest[] = [];
  const client: DecisionsClient = {
    async ask(req) {
      requests.push(req);
      const script = scripts.shift();
      if (!script) throw new Error("Hết kịch bản decisions");
      const answers: Record<string, Answer> = {};
      for (const q of req.questions) {
        if (script[q.name] === "REFUSAL") {
          answers[q.name] = { type: "refusal", name: q.name };
        } else if (q.type === "predicate") {
          answers[q.name] = { type: "predicate", name: q.name, probability: Number(script[q.name] ?? 1) };
        } else {
          const choice = script[q.name] ?? q.choices[0]!.value;
          if (!q.choices.some((c) => c.value === choice)) throw new Error(`Kịch bản chọn ${choice} không có trong câu ${q.name}`);
          answers[q.name] = { type: "choice", name: q.name, choice, probabilities: { [choice]: 1 }, confidence: Number(script.confidence ?? 1) };
        }
      }
      return { answers, usage: { inputTokens: 100, cachedTokens: 0 }, latencyMs: 1 };
    },
  };
  return { client, requests };
}

export function testConfig(): Config {
  return { ...loadConfig({}), runsDir: mkdtempSync(join(tmpdir(), "de2e-")) };
}
