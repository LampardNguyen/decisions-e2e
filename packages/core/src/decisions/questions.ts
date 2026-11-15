import type { Decision, Element, Op, Snapshot, TargetOp } from "../types.js";
import { requireAnswer, type DecisionsResult, type InputMessage, type Question } from "./client.js";
import { NEXT_ACTION, OPERATION_QUESTION, OP_DESCRIPTIONS, TARGET_QUESTIONS } from "./prompts.js";

/** Giới hạn của API: mỗi câu `choice` nhận 2–255 choices. */
export const MAX_CHOICES = 255;
export const NO_KEY = "NONE";

const TARGET_OPS: TargetOp[] = ["CLICK", "TYPE_TEXT", "SELECT", "PRESS_ENTER"];
const ALWAYS_OPS: Op[] = ["SCROLL_DOWN", "SCROLL_UP", "WAIT", "DONE", "BLOCKED"];

const targetName = (op: TargetOp) => `${op.toLowerCase()}_target`;

function context(e: Element): string | undefined {
  return e.contextPath.length > 1 ? e.contextPath.slice(1).join(" > ") : undefined;
}

/** Một dòng mô tả element cho model, ví dụ: `[12] textbox "Email" · value "a@b.c" · in iframe[pay]`. */
export function describeElement(e: Element): string {
  const parts = [`[${e.index}] ${e.role} "${e.label}"`];
  if (e.value !== undefined && e.value !== "") parts.push(`value "${e.value}"`);
  if (e.checked !== undefined) parts.push(e.checked ? "checked" : "unchecked");
  if (e.selected) parts.push("selected");
  if (e.expanded !== undefined) parts.push(e.expanded ? "expanded" : "collapsed");
  if (e.disabled) parts.push("disabled");
  const ctx = context(e);
  if (ctx) parts.push(`in ${ctx}`);
  if (e.nearText) parts.push(`near "${e.nearText}"`);
  return parts.join(" · ");
}

/**
 * `input` dùng chung cho request chính và request phụ của cùng một bước.
 * Không chứa `ref` hay options của select; với các giới hạn độ dài ở driver, JSON này
 * luôn nằm dưới giới hạn 256 KiB / 10.000 giá trị của `input_json`.
 */
export function buildInput(goal: string, snap: Snapshot, history: string[]): InputMessage[] {
  const elements = snap.elements.map((e) => ({
    index: e.index,
    role: e.role,
    label: e.label,
    ...(e.value !== undefined && { value: e.value }),
    ...(e.checked !== undefined && { checked: e.checked }),
    ...(e.selected !== undefined && { selected: e.selected }),
    ...(e.expanded !== undefined && { expanded: e.expanded }),
    ...(e.disabled && { disabled: true }),
    ...(context(e) && { context: context(e) }),
    ...(e.nearText && { near: e.nearText }),
  }));
  return [
    { role: "developer", content: NEXT_ACTION },
    {
      role: "user",
      content: [
        {
          type: "input_json",
          data: {
            goal,
            page: { url: snap.url, title: snap.title, visible_text: snap.visibleText },
            elements,
            elements_truncated: snap.truncated,
            recent_actions: history.slice(-10),
          },
        },
      ],
    },
  ];
}

/** Element có thể là đích của op (bỏ element disabled). */
export function candidates(snap: Snapshot, op: TargetOp): Element[] {
  return snap.elements.filter((e) => !e.disabled && e.ops.includes(op)).slice(0, MAX_CHOICES);
}

/** Câu `operation` + một câu target cho mỗi op có ≥ 2 ứng viên (API không nhận câu 1 choice). */
export function buildStepQuestions(snap: Snapshot): Question[] {
  const ops: Op[] = [...TARGET_OPS.filter((op) => candidates(snap, op).length > 0), ...ALWAYS_OPS];
  const questions: Question[] = [
    {
      type: "choice",
      name: "operation",
      instructions: OPERATION_QUESTION,
      choices: ops.map((op) => ({ value: op, description: OP_DESCRIPTIONS[op] })),
    },
  ];
  for (const op of TARGET_OPS) {
    const cands = candidates(snap, op);
    if (cands.length < 2) continue;
    questions.push({
      type: "choice",
      name: targetName(op),
      instructions: TARGET_QUESTIONS[op],
      choices: cands.map((e) => ({ value: String(e.index), description: describeElement(e) })),
    });
  }
  return questions;
}

/** Ghép đáp án `operation` với đáp án target khớp op; các target khác bỏ qua (kể cả khi bị từ chối). */
export function readDecision(snap: Snapshot, result: DecisionsResult): Decision {
  const opAnswer = requireAnswer(result, "operation", "choice");
  const op = opAnswer.choice as Op;
  const decision: Decision = {
    op,
    opProbabilities: opAnswer.probabilities,
    opConfidence: opAnswer.confidence,
    confidence: opAnswer.confidence,
    latencyMs: result.latencyMs,
    usage: { ...result.usage },
  };
  if (!(TARGET_OPS as Op[]).includes(op)) return decision;

  const cands = candidates(snap, op as TargetOp);
  if (cands.length === 1) {
    // Đúng 1 ứng viên nên không hỏi.
    decision.target = cands[0]!.index;
    decision.targetConfidence = 1;
  } else {
    // Chỉ câu target của op đã chọn là bắt buộc; các câu target khác bị từ chối cũng không sao.
    const answer = requireAnswer(result, targetName(op as TargetOp), "choice");
    decision.target = Number(answer.choice);
    decision.targetProbabilities = answer.probabilities;
    decision.targetConfidence = answer.confidence;
  }
  decision.confidence = Math.min(decision.opConfidence, decision.targetConfidence);
  return decision;
}

/** Request phụ khi TYPE_TEXT: chọn key trong `data` cho ô đã chọn. Giá trị secret không bao giờ xuất hiện. */
export function valueKeyQuestion(element: Element, data: Record<string, string>, isSecret: (v: string) => boolean): Question {
  return {
    type: "choice",
    name: "value_key",
    instructions: `The agent will type into this field: ${describeElement(element)}. Which data key holds the value that belongs in this field? Answer ${NO_KEY} if none of the keys fits.`,
    choices: [
      ...Object.entries(data)
        .slice(0, MAX_CHOICES - 1)
        .map(([key, v]) => ({ value: key, description: isSecret(v) ? "(secret value)" : `value: ${v}` })),
      { value: NO_KEY, description: "No available key fits this field." },
    ],
  };
}

/** Request phụ khi SELECT: chọn option của <select> đã chọn. Cần ≥ 2 option. */
export function selectOptionQuestion(element: Element): Question {
  return {
    type: "choice",
    name: "select_option",
    instructions: `The agent will change this dropdown: ${describeElement(element)}. Which option should be selected to make progress toward the goal?`,
    choices: (element.options ?? []).slice(0, MAX_CHOICES).map((o) => ({ value: o.index, description: o.label })),
  };
}
