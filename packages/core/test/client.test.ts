import { expect, test } from "vitest";
import { DecisionsError, parseResponse, requireAnswer, type Question } from "../src/index.js";

const questions: Question[] = [
  { type: "predicate", name: "p", instructions: "?" },
  { type: "choice", name: "c", instructions: "?", choices: [{ value: "a" }, { value: "b" }] },
];
const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 4, cache_write_tokens: 0 } };
const pred = { type: "predicate", name: "p", probability: 0.9 };
const choice = (over = {}) => ({
  type: "choice",
  name: "c",
  choice: "a",
  probabilities: [{ value: "a", probability: 0.7 }, { value: "b", probability: 0.3 }],
  confidence: 0.6,
  ...over,
});

test("response hợp lệ", () => {
  const r = parseResponse(questions, { model: "m", answers: [pred, choice()], usage });
  expect(r.answers.p).toMatchObject({ probability: 0.9 });
  expect(r.answers.c).toMatchObject({ choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.6 });
  expect(r.usage).toEqual({ inputTokens: 10, cachedTokens: 4 });
});

test.each([
  ["choice ngoài tập", [pred, choice({ choice: "z" })]],
  ["xác suất > 1", [{ ...pred, probability: 1.5 }, choice()]],
  ["xác suất NaN", [{ ...pred, probability: Number.NaN }, choice()]],
  ["xác suất cho choice lạ", [pred, choice({ probabilities: [{ value: "z", probability: 1 }] })]],
  ["thiếu answer", [pred]],
  ["sai loại answer", [choice(), pred]],
])("từ chối response: %s", (_, answers) => {
  expect(() => parseResponse(questions, { answers, usage })).toThrow(DecisionsError);
});

test("refusal được giữ lại theo từng câu; chỉ lỗi khi câu đó là câu cần dùng", () => {
  const r = parseResponse(questions, { answers: [pred, { type: "refusal", name: "c" }], usage });
  expect(r.answers.c).toEqual({ type: "refusal", name: "c" });
  expect(requireAnswer(r, "p", "predicate").probability).toBe(0.9);
  expect(() => requireAnswer(r, "c", "choice")).toThrow(/từ chối trả lời câu "c"/);
  expect(() => requireAnswer(r, "missing", "choice")).toThrow(DecisionsError);
});
