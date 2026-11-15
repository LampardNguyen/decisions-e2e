import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { DecisionsClient } from "./decisions/client.js";
import type { Driver } from "./driver.js";
import { runDo, type RunContext } from "./loop.js";
import type { ScenarioStep } from "./scenario.js";
import { Trace } from "./trace.js";
import type { CheckResult, DoResult, Snapshot } from "./types.js";
import { Secrets } from "./values.js";
import { runCheck } from "./verify.js";

/** Một phiên test: một driver + lịch sử + secret + trace. */
export class Session {
  readonly id = randomUUID().slice(0, 8);
  readonly trace: Trace;
  /** URL đã mở và các lệnh do/check đã chạy, theo thứ tự — dùng để lưu thành file .test.md. */
  readonly recorded: { url?: string; steps: ScenarioStep[] } = { steps: [] };
  private ctx: RunContext;

  constructor(driver: Driver, decisions: DecisionsClient, config: Config, env: NodeJS.ProcessEnv = process.env) {
    this.trace = new Trace(config.runsDir, this.id);
    this.ctx = { sessionId: this.id, driver, decisions, config, secrets: new Secrets(env), trace: this.trace, history: [] };
  }

  async open(url: string, opts: { headed?: boolean; viewport?: { width: number; height: number } } = {}) {
    const { driver, config } = this.ctx;
    await driver.open(url, { headed: opts.headed ?? config.headed, viewport: opts.viewport });
    const screenshotPath = this.trace.screenshotPath("open");
    await driver.screenshot(screenshotPath);
    this.trace.event("open", { url, screenshotPath });
    this.recorded.url ??= url;
    return { url: await driver.currentUrl(), screenshotPath };
  }

  do(instruction: string, data?: Record<string, string>, maxSteps?: number): Promise<DoResult> {
    this.recorded.steps.push({ do: instruction, ...(data && Object.keys(data).length && { data }), ...(maxSteps && { max_steps: maxSteps }) });
    return runDo(this.ctx, instruction, data, maxSteps);
  }

  check(expectations: string[], threshold?: number): Promise<CheckResult[]> {
    // check trước mọi do (vd. kiểm tra trang vừa mở) không có bước để gắn vào: bỏ qua khi lưu.
    const last = this.recorded.steps.at(-1);
    if (last) last.check = [...(last.check ?? []), ...expectations];
    return runCheck(this.ctx, expectations, threshold);
  }

  /** Chụp màn hình hiện tại, trả về đường dẫn file PNG. */
  async screenshot(fullPage = false): Promise<string> {
    const path = this.trace.screenshotPath("screenshot");
    await this.ctx.driver.screenshot(path, { fullPage });
    return path;
  }

  /** Snapshot hiện tại (đã che secret) — dùng để debug bảng element. */
  async snapshot(): Promise<Snapshot> {
    return this.ctx.secrets.redact(await this.ctx.driver.snapshot());
  }

  /** Gỡ lỗi: text đang hiển thị nhưng không thuộc element nào (đã che secret). */
  async debugUnlisted(): Promise<string> {
    const { driver, secrets } = this.ctx;
    return driver.debugUnlisted ? secrets.redact(await driver.debugUnlisted()) : "(driver này không hỗ trợ soi DOM)";
  }

  url(): Promise<string | null> {
    return this.ctx.driver.currentUrl();
  }

  /** Đóng driver, trả về đường dẫn report.md. */
  async close(): Promise<string> {
    await this.ctx.driver.close();
    return this.trace.writeReport();
  }
}

/** Giữ nhiều session theo id; session không hoạt động quá `idleMs` sẽ tự đóng. */
export class SessionManager {
  private sessions = new Map<string, { session: Session; lastUsed: number }>();
  private timer: NodeJS.Timeout;

  constructor(
    private create: (opts?: { runsDir?: string }) => Session,
    private idleMs = 30 * 60_000,
  ) {
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  /** Tạo session mới (chưa mở trang). `runsDir`: nơi ghi kết quả, mặc định theo config. */
  add(opts?: { runsDir?: string }): Session {
    const session = this.create(opts);
    this.sessions.set(session.id, { session, lastUsed: Date.now() });
    return session;
  }

  /** Session KHÔNG được quản lý (không vào danh sách, không tự đóng): người gọi tự đóng, vd. runScenario. */
  spawn(opts?: { runsDir?: string }): Session {
    return this.create(opts);
  }

  get(id: string): Session {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`Không có session "${id}" (chưa mở, đã đóng, hoặc đã hết hạn sau 30 phút không hoạt động). Hãy gọi e2e_open.`);
    entry.lastUsed = Date.now();
    return entry.session;
  }

  /** Đóng session, trả về đường dẫn report.md. */
  async close(id: string): Promise<string> {
    const session = this.get(id);
    this.sessions.delete(id);
    return session.close();
  }

  async sweep(now = Date.now()): Promise<void> {
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastUsed >= this.idleMs) await this.close(id).catch(() => {});
    }
  }

  async closeAll(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id).catch(() => {})));
  }
}
