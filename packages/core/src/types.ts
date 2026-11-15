export type Op =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "PRESS_ENTER"
  | "SCROLL_UP"
  | "SCROLL_DOWN"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

/** Các op cần chọn element đích. */
export type TargetOp = "CLICK" | "TYPE_TEXT" | "SELECT" | "PRESS_ENTER";

export interface ElementOption {
  index: string;
  label: string;
  value: string;
}

export interface Element {
  /** 1..N, ổn định trong MỘT snapshot. */
  index: number;
  role: string;
  label: string;
  /** Giá trị hiện tại. Ô password / ô đã điền secret chỉ là "<filled>" hoặc "<empty>". */
  value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** Chỉ có ở <select> native. */
  options?: ElementOption[];
  ops: TargetOp[];
  /** web: ["main"] | ["main","iframe[payment]"]. */
  contextPath: string[];
  nearText?: string;
  /** Id nội bộ do driver cấp — KHÔNG gửi model. */
  ref: string;
}

export interface Snapshot {
  id: string;
  url: string | null;
  title: string;
  visibleText: string;
  elements: Element[];
  truncated: boolean;
  /** Hash ngữ nghĩa (url + trạng thái các element) để kiểm tra freshness. */
  fingerprint: string;
  takenAt: number;
}

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
}

export interface Decision {
  op: Op;
  target?: number;
  /** Khi SELECT: index option đã chọn (request phụ). */
  optionIndex?: string;
  /** Khi TYPE_TEXT: key trong data (request phụ). */
  valueKey?: string;
  opProbabilities: Record<string, number>;
  targetProbabilities?: Record<string, number>;
  opConfidence: number;
  targetConfidence?: number;
  /** min(opConfidence, targetConfidence) — dùng để so ngưỡng. */
  confidence: number;
  latencyMs: number;
  usage: Usage;
}

export interface StepRecord {
  step: number;
  decision: Decision;
  elementLabel?: string;
  typedValueMasked?: string;
  urlBefore: string | null;
  urlAfter: string | null;
  pageChanged: boolean;
  screenshotPath?: string;
  error?: string;
}

export interface DoResult {
  status: "done" | "blocked" | "needs_input" | "max_steps" | "error";
  message: string;
  finalUrl: string | null;
  screenshotPath: string;
  steps: StepRecord[];
  missingField?: { label: string; role: string };
}

export interface CheckResult {
  expectation: string;
  passed: boolean;
  probability: number;
  threshold: number;
  screenshotPath: string;
}
