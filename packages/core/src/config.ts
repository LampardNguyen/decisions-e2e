export interface Config {
  apiKey: string;
  model: string;
  maxSteps: number;
  maxElements: number;
  minConfidence: number;
  checkThreshold: number;
  stepScreenshots: boolean;
  runsDir: string;
  headed: boolean;
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Giá trị cấu hình không phải số: ${v}`);
  return n;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiKey: env.OPENAI_API_KEY ?? "",
    model: env.DECISIONS_MODEL || "gpt-6-luna",
    maxSteps: num(env.E2E_MAX_STEPS, 25),
    maxElements: num(env.E2E_MAX_ELEMENTS, 250),
    // Giá trị tạm — hiệu chỉnh bằng số liệu PoC (xem docs/poc-results.md).
    minConfidence: num(env.E2E_MIN_CONFIDENCE, 0.35),
    checkThreshold: num(env.E2E_CHECK_THRESHOLD, 0.7),
    stepScreenshots: bool(env.E2E_STEP_SCREENSHOTS, false),
    runsDir: env.E2E_RUNS_DIR || "./runs",
    headed: bool(env.E2E_HEADED, true),
  };
}
