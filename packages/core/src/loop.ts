import type { Config } from "./config.js";
import type { DecisionsClient, DecisionsRequest, DecisionsResult } from "./decisions/client.js";
import { DecisionsError, requireAnswer } from "./decisions/client.js";
import {
  NO_KEY,
  buildInput,
  buildStepQuestions,
  readDecision,
  selectOptionQuestion,
  valueKeyQuestion,
} from "./decisions/questions.js";
import { StalePage, type Driver } from "./driver.js";
import type { Trace } from "./trace.js";
import type { DoResult, Element, Snapshot, StepRecord } from "./types.js";
import { MissingSecret, isSecretTemplate, type ResolvedValue, type Secrets } from "./values.js";

export interface RunContext {
  sessionId: string;
  driver: Driver;
  decisions: DecisionsClient;
  config: Config;
  secrets: Secrets;
  trace: Trace;
  /** Lịch sử thao tác của cả session — lần `do` sau vẫn thấy các bước đã làm. */
  history: string[];
}

const MAX_STALE = 5;
const MAX_STUCK = 3;
/** Số lần được gặp lại cùng một trạng thái trang trong một `do` trước khi coi là dao động (vd. bấm bật/tắt qua lại). */
const MAX_VISITS = 3;

// Gồm cả text hiển thị: một thao tác chỉ làm đổi text (vd. hiện thông báo) là trạng thái MỚI, không phải quay lại.
const stateKey = (s: Snapshot) => `${s.url}|${s.fingerprint}|${s.visibleText}`;

/** Gửi request (đã che secret) và ghi vào trace. */
export async function ask(ctx: RunContext, req: DecisionsRequest): Promise<DecisionsResult> {
  const safe = ctx.secrets.redact({ ...req, cacheKey: ctx.sessionId });
  try {
    const result = await ctx.decisions.ask(safe);
    ctx.trace.event("request", { input: safe.input, questions: safe.questions, ...result });
    return result;
  } catch (e) {
    // Ghi cả request hỏng để còn điều tra được.
    ctx.trace.event("request_error", { input: safe.input, questions: safe.questions, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

const changed = (a: Snapshot, b: Snapshot) =>
  a.url !== b.url || a.fingerprint !== b.fingerprint || a.visibleText !== b.visibleText;

export async function runDo(
  ctx: RunContext,
  instruction: string,
  data: Record<string, string> = {},
  maxSteps = ctx.config.maxSteps,
): Promise<DoResult> {
  const { driver, config, trace, history } = ctx;
  const steps: StepRecord[] = [];

  const finish = async (status: DoResult["status"], message: string, missing?: Element): Promise<DoResult> => {
    const screenshotPath = trace.screenshotPath("do-final");
    await driver.screenshot(screenshotPath);
    const result: DoResult = {
      status,
      message,
      finalUrl: await driver.currentUrl(),
      screenshotPath,
      steps,
      ...(missing && { missingField: { label: missing.label, role: missing.role } }),
    };
    trace.event("do", { instruction, data, result });
    trace.save();
    return result;
  };

  let snap = await driver.snapshot();
  let stale = 0;
  let stuck = 0;
  const visits = new Map<string, number>([[stateKey(snap), 1]]);

  for (let step = 1; step <= maxSteps; step++) {
    const input = buildInput(instruction, snap, history);
    let decision;
    let element: Element | undefined;
    let value: ResolvedValue | undefined;
    try {
      const main = await ask(ctx, { input, questions: buildStepQuestions(snap) });
      decision = readDecision(snap, main);

      if (decision.confidence < config.minConfidence) {
        return finish("blocked", `Không đủ chắc chắn để thao tác (${decision.op}, confidence ${decision.confidence}).`);
      }
      if (decision.op === "DONE") return finish("done", "Engine cho rằng yêu cầu đã hoàn tất — hãy xác nhận bằng check.");
      if (decision.op === "BLOCKED") return finish("blocked", "Không có thao tác nào giúp tiến triển.");

      element = snap.elements.find((e) => e.index === decision!.target);

      // Request phụ: quyết định phụ thuộc vào element đã chọn nên phải tách request (dùng lại nguyên input → trúng cache).
      if (decision.op === "TYPE_TEXT" && element) {
        let key = NO_KEY;
        if (Object.keys(data).length > 0) {
          const sub = await ask(ctx, { input, questions: [valueKeyQuestion(element, data, isSecretTemplate)] });
          key = requireAnswer(sub, "value_key", "choice").choice;
          decision.latencyMs += sub.latencyMs;
          decision.usage.inputTokens += sub.usage.inputTokens;
          decision.usage.cachedTokens += sub.usage.cachedTokens;
        }
        if (key === NO_KEY) {
          return finish("needs_input", `Cần giá trị để nhập vào ô "${element.label}" nhưng data không có key phù hợp.`, element);
        }
        decision.valueKey = key;
        value = ctx.secrets.resolve(data[key]!);
      }
      if (decision.op === "SELECT" && element) {
        const options = element.options ?? [];
        if (options.length === 0) return finish("blocked", `Dropdown "${element.label}" không có option nào.`);
        if (options.length === 1) {
          decision.optionIndex = options[0]!.index;
        } else {
          const sub = await ask(ctx, { input, questions: [selectOptionQuestion(element)] });
          decision.optionIndex = requireAnswer(sub, "select_option", "choice").choice;
          decision.latencyMs += sub.latencyMs;
          decision.usage.inputTokens += sub.usage.inputTokens;
          decision.usage.cachedTokens += sub.usage.cachedTokens;
        }
      }
    } catch (e) {
      if (e instanceof DecisionsError || e instanceof MissingSecret) return finish("error", e.message);
      throw e;
    }

    let error: string | undefined;
    try {
      await driver.act(
        { op: decision.op, element, optionIndex: decision.optionIndex, text: value?.text, secret: value?.secret },
        snap,
      );
    } catch (e) {
      if (e instanceof StalePage) {
        // Không có gì được thực thi: snapshot lại, quyết định lại, không tính là một bước.
        if (++stale > MAX_STALE) return finish("blocked", "Trang thay đổi liên tục, không thể thao tác ổn định.");
        snap = await driver.snapshot();
        step--;
        continue;
      }
      error = ctx.secrets.redact(e instanceof Error ? e.message : String(e)).split("\n")[0];
    }
    stale = 0;

    if (!error) {
      await driver.waitForSettle(decision.op === "CLICK" ? "after_click" : decision.op === "TYPE_TEXT" ? "after_type" : "explicit");
    }
    const next = await driver.snapshot();
    const pageChanged = changed(snap, next);

    const record: StepRecord = {
      step,
      decision,
      ...(element && { elementLabel: element.label }),
      ...(value && { typedValueMasked: value.secret ? value.masked : value.text }),
      urlBefore: snap.url,
      urlAfter: next.url,
      pageChanged,
      ...(error && { error }),
    };
    if (config.stepScreenshots) {
      record.screenshotPath = trace.screenshotPath(`do-step-${String(step).padStart(2, "0")}`);
      await driver.screenshot(record.screenshotPath);
    }
    steps.push(record);
    trace.event("step", { ...record });

    let line: string = decision.op;
    // Không ghi index hay trạng thái của element: chúng chỉ đúng trong snapshot lúc đó.
    if (element) {
      line += ` ${element.role} "${element.label}"`;
      if (element.contextPath.length > 1) line += ` in ${element.contextPath.slice(1).join(" > ")}`;
    }
    if (decision.valueKey) line += ` with data key "${decision.valueKey}"`;
    if (decision.optionIndex !== undefined) {
      line += ` option "${element?.options?.find((o) => o.index === decision.optionIndex)?.label ?? decision.optionIndex}"`;
    }
    // Chỉ ghi dữ kiện đo được về thay đổi, để model thấy khi một thao tác hoàn tác thao tác trước.
    const seen = pageChanged ? (visits.get(stateKey(next)) ?? 0) + 1 : 0;
    if (pageChanged) visits.set(stateKey(next), seen);
    if (error) line += ` → FAILED: ${error}`;
    else if (!pageChanged) line += " → no visible change";
    else if (seen > 1) line += " → page went BACK to a state seen before (this action undid an earlier one)";
    else line += ` → page changed (${snap.elements.length} → ${next.elements.length} elements)`;
    history.push(line);

    if (seen >= MAX_VISITS) {
      return finish("blocked", `Trang quay lại cùng một trạng thái ${seen} lần (thao tác bật/tắt lặp lại "${element?.label ?? decision.op}") — dừng để tránh lặp vô ích.`);
    }

    if (decision.op !== "WAIT") {
      stuck = pageChanged ? 0 : stuck + 1;
      if (stuck >= MAX_STUCK) return finish("blocked", `${MAX_STUCK} bước liên tiếp không làm trang thay đổi.`);
    }
    snap = next;
  }

  return finish("max_steps", `Đã chạy hết ${maxSteps} bước mà chưa xong.`);
}
