import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface TraceEvent {
  t: number;
  type: string;
  [key: string]: unknown;
}

/** Ghi trace.json / report.md / screenshots cho một session. Người gọi phải che secret trước khi ghi. */
export class Trace {
  readonly dir: string;
  private events: TraceEvent[] = [];
  private shots = 0;
  private startedAt = Date.now();

  constructor(runsDir: string, sessionId: string) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    this.dir = resolve(runsDir, `${stamp}_${sessionId}`);
    mkdirSync(join(this.dir, "screenshots"), { recursive: true });
  }

  screenshotPath(label: string): string {
    return join(this.dir, "screenshots", `${String(this.shots++).padStart(3, "0")}-${label}.png`);
  }

  event(type: string, data: Record<string, unknown>): void {
    this.events.push({ t: Date.now(), type, ...data });
  }

  save(): void {
    writeFileSync(join(this.dir, "trace.json"), JSON.stringify(this.events, null, 2));
  }

  /** Tóm tắt cho người đọc. Trả về đường dẫn report.md. */
  writeReport(): string {
    const lines = ["# Báo cáo E2E", ""];
    let tokens = 0;
    let requests = 0;
    for (const e of this.events) {
      if (e.type === "request") {
        requests++;
        tokens += (e.usage as { inputTokens: number }).inputTokens;
      } else if (e.type === "open") {
        lines.push(`## open: ${e.url}`, "", `![](${e.screenshotPath})`, "");
      } else if (e.type === "do") {
        const r = e.result as { status: string; message: string; finalUrl: string | null; screenshotPath: string; steps: unknown[] };
        lines.push(
          `## do: ${e.instruction}`,
          "",
          `- Kết quả: **${r.status}** — ${r.message}`,
          `- Số bước: ${r.steps.length}`,
          `- URL cuối: ${r.finalUrl}`,
          "",
          `![](${r.screenshotPath})`,
          "",
        );
      } else if (e.type === "check") {
        const results = e.results as { expectation: string; passed: boolean; probability: number; screenshotPath: string }[];
        for (const r of results) {
          lines.push(`## check: ${r.expectation}`, "", `- ${r.passed ? "✅ PASS" : "❌ FAIL"} (xác suất ${r.probability})`, "");
        }
        if (results[0]) lines.push(`![](${results[0].screenshotPath})`, "");
      }
    }
    lines.push(
      "## Tổng kết",
      "",
      `- Thời gian: ${((Date.now() - this.startedAt) / 1000).toFixed(1)} s`,
      `- Request Decisions: ${requests}`,
      `- Token input: ${tokens}`,
      "",
    );
    this.save();
    const path = join(this.dir, "report.md");
    writeFileSync(path, lines.join("\n"));
    return path;
  }
}
