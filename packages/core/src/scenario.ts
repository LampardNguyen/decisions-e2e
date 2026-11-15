import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "./session.js";

export interface ScenarioStep {
  /** Mục tiêu ngôn ngữ tự nhiên, như tham số `instruction` của e2e_do. */
  do: string;
  data?: Record<string, string>;
  /** Kỳ vọng phải đạt sau bước này. */
  check?: string[];
  max_steps?: number;
}

export interface ScenarioResult {
  passed: boolean;
  /** Bước thất bại (đánh số từ 1), không có nếu passed. */
  failed_step?: number;
  reason?: string;
  total_steps: number;
  run_dir: string;
  report: string;
  final_url: string | null;
}

/**
 * Chạy trọn một kịch bản trong một session: open → (do, check)* → screenshot full page → close.
 * Dừng ở bước đầu tiên không đạt. Ghi result.json vào thư mục run. Không trả ảnh cho người gọi.
 */
export async function runScenario(
  session: Session,
  url: string,
  steps: ScenarioStep[],
  opts: { headed?: boolean; threshold?: number } = {},
): Promise<ScenarioResult> {
  let failed: { step: number; reason: string } | undefined;
  let finalUrl: string | null = null;
  try {
    await session.open(url, { headed: opts.headed });
    for (const [i, s] of steps.entries()) {
      const r = await session.do(s.do, s.data, s.max_steps);
      if (r.status !== "done") {
        failed = { step: i + 1, reason: `${r.status}: ${r.message}` };
        break;
      }
      if (s.check?.length) {
        const bad = (await session.check(s.check, opts.threshold)).filter((c) => !c.passed);
        if (bad.length) {
          failed = { step: i + 1, reason: bad.map((c) => `check không đạt (${c.probability}): ${c.expectation}`).join("; ") };
          break;
        }
      }
    }
  } catch (e) {
    failed ??= { step: 0, reason: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
  await session.screenshot(true).catch(() => {});
  finalUrl = await session.url().catch(() => null);
  const report = await session.close();
  const result: ScenarioResult = {
    passed: !failed,
    ...(failed && { failed_step: failed.step, reason: failed.reason }),
    total_steps: steps.length,
    run_dir: session.trace.dir,
    report,
    final_url: finalUrl,
  };
  writeFileSync(join(session.trace.dir, "result.json"), JSON.stringify({ url, steps, ...result }, null, 2));
  return result;
}
