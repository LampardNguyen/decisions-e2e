import { expect, test } from "vitest";
import { buildInput, buildStepQuestions, describeElement, readDecision, valueKeyQuestion } from "../src/index.js";
import { el, snap } from "./helpers.js";

const choices = (qs: ReturnType<typeof buildStepQuestions>, name: string) => {
  const q = qs.find((q) => q.name === name);
  return q?.type === "choice" ? q.choices.map((c) => c.value) : undefined;
};

test("operation chỉ liệt kê op có element hỗ trợ, luôn có op điều khiển", () => {
  const qs = buildStepQuestions(snap([el(1, "button", "A"), el(2, "button", "B")]));
  expect(choices(qs, "operation")).toEqual(["CLICK", "SCROLL_DOWN", "SCROLL_UP", "WAIT", "DONE", "BLOCKED"]);
  expect(qs.map((q) => q.name)).toEqual(["operation", "click_target"]);
});

test("câu target chỉ gồm element hỗ trợ op đó, bỏ element disabled", () => {
  const s = snap([
    el(1, "textbox", "Email"),
    el(2, "textbox", "Password"),
    el(3, "checkbox", "Remember", { checked: false }),
    el(4, "button", "Log in"),
    el(5, "button", "Disabled", { disabled: true }),
    el(6, "select", "Country"),
  ]);
  const qs = buildStepQuestions(s);
  expect(choices(qs, "type_text_target")).toEqual(["1", "2"]);
  expect(choices(qs, "click_target")).toEqual(["3", "4"]);
  // Chỉ 1 select → không hỏi (API yêu cầu ≥ 2 choices) nhưng SELECT vẫn là op hợp lệ.
  expect(choices(qs, "select_target")).toBeUndefined();
  expect(choices(qs, "operation")).toContain("SELECT");
});

test("đúng 1 ứng viên thì dùng luôn, confidence = confidence của operation", () => {
  const s = snap([el(1, "select", "Country"), el(2, "button", "A"), el(3, "button", "B")]);
  const d = readDecision(s, {
    answers: { operation: { type: "choice", name: "operation", choice: "SELECT", probabilities: { SELECT: 0.8 }, confidence: 0.6 } },
    usage: { inputTokens: 1, cachedTokens: 0 },
    latencyMs: 1,
  });
  expect(d).toMatchObject({ op: "SELECT", target: 1, targetConfidence: 1, confidence: 0.6 });
});

test("confidence = min(operation, target khớp op); target của op khác bị bỏ qua", () => {
  const s = snap([el(1, "button", "A"), el(2, "button", "B"), el(3, "textbox", "X"), el(4, "textbox", "Y")]);
  const d = readDecision(s, {
    answers: {
      operation: { type: "choice", name: "operation", choice: "CLICK", probabilities: {}, confidence: 0.9 },
      click_target: { type: "choice", name: "click_target", choice: "2", probabilities: {}, confidence: 0.4 },
      type_text_target: { type: "choice", name: "type_text_target", choice: "4", probabilities: {}, confidence: 0.1 },
    },
    usage: { inputTokens: 1, cachedTokens: 0 },
    latencyMs: 1,
  });
  expect(d).toMatchObject({ op: "CLICK", target: 2, confidence: 0.4 });
});

test("input không chứa ref; context iframe có trong mô tả", () => {
  const e = el(1, "textbox", "Card", { contextPath: ["main", "iframe[pay]"], ref: "SECRET-REF" });
  expect(JSON.stringify(buildInput("goal", snap([e]), []))).not.toContain("SECRET-REF");
  expect(describeElement(e)).toBe('[1] textbox "Card" · in iframe[pay]');
});

test("value_key: không lộ giá trị secret, luôn có NONE", () => {
  const q = valueKeyQuestion(el(1, "textbox", "Email"), { email: "a@b.c", password: "{{PW}}" }, (v) => v.includes("{{"));
  expect(q.type === "choice" && q.choices).toEqual([
    { value: "email", description: "value: a@b.c" },
    { value: "password", description: "(secret value)" },
    { value: "NONE", description: "No available key fits this field." },
  ]);
});
