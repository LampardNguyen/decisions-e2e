import OpenAI from "openai";
import { z } from "zod";
import type { Usage } from "../types.js";

export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" | "original" }
  | { type: "input_json"; data: Record<string, unknown> };

export type InputMessage = { role: "developer"; content: string } | { role: "user"; content: InputPart[] };

export type Question =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description?: string }[] };

export type Answer =
  | { type: "predicate"; name: string; probability: number }
  | { type: "choice"; name: string; choice: string; probabilities: Record<string, number>; confidence: number }
  /** Model không trả lời câu này. Thường gặp khi giả định của câu hỏi sai (vd. hỏi "click vào đâu" lúc chưa cần click). */
  | { type: "refusal"; name: string };

export interface DecisionsRequest {
  input: InputMessage[];
  questions: Question[];
  cacheKey?: string;
}

export interface DecisionsResult {
  /** Theo `name` của câu hỏi. */
  answers: Record<string, Answer>;
  usage: Usage;
  latencyMs: number;
}

export interface DecisionsClient {
  ask(req: DecisionsRequest): Promise<DecisionsResult>;
}

/** Response không dùng được — không có thao tác nào được thực thi dựa trên nó. */
export class DecisionsError extends Error {
  constructor(message: string) {
    super(`Decisions API: ${message} (không có thao tác nào được thực thi)`);
    this.name = "DecisionsError";
  }
}

const probability = z.number().min(0).max(1);

const responseSchema = z.object({
  answers: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("predicate"), probability }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        probabilities: z.array(z.object({ value: z.string(), probability })),
        confidence: probability,
      }),
      z.object({ type: z.literal("refusal") }),
    ]),
  ),
  usage: z.object({
    input_tokens: z.number(),
    input_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
  }),
});

/** Kiểm tra response khớp với các câu đã hỏi (answers trả về đúng thứ tự câu hỏi). */
export function parseResponse(questions: Question[], raw: unknown): Pick<DecisionsResult, "answers" | "usage"> {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new DecisionsError(`response sai định dạng: ${parsed.error.issues[0]?.message ?? "?"}`);
  const { answers: rawAnswers, usage } = parsed.data;
  if (rawAnswers.length !== questions.length) {
    throw new DecisionsError(`nhận ${rawAnswers.length} answer cho ${questions.length} câu hỏi`);
  }

  const answers: Record<string, Answer> = {};
  questions.forEach((q, i) => {
    const a = rawAnswers[i]!;
    if (a.type === "refusal") {
      answers[q.name] = { type: "refusal", name: q.name };
      return;
    }
    if (a.type !== q.type) throw new DecisionsError(`câu "${q.name}" hỏi ${q.type} nhưng nhận ${a.type}`);
    if (a.type === "predicate") {
      answers[q.name] = { type: "predicate", name: q.name, probability: a.probability };
      return;
    }
    const allowed = new Set(q.type === "choice" ? q.choices.map((c) => c.value) : []);
    if (!allowed.has(a.choice)) throw new DecisionsError(`câu "${q.name}" trả choice ngoài tập đã cho: ${a.choice}`);
    const probabilities: Record<string, number> = {};
    for (const p of a.probabilities) {
      if (!allowed.has(p.value)) throw new DecisionsError(`câu "${q.name}" trả xác suất cho choice lạ: ${p.value}`);
      probabilities[p.value] = p.probability;
    }
    answers[q.name] = { type: "choice", name: q.name, choice: a.choice, probabilities, confidence: a.confidence };
  });

  return {
    answers,
    usage: { inputTokens: usage.input_tokens, cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0 },
  };
}

/** Lấy đáp án của câu hỏi mà bước hiện tại THẬT SỰ cần; thiếu hoặc bị từ chối → DecisionsError. */
export function requireAnswer<T extends "predicate" | "choice">(
  result: Pick<DecisionsResult, "answers">,
  name: string,
  type: T,
): Extract<Answer, { type: T }> {
  const a = result.answers[name];
  if (a?.type === "refusal") throw new DecisionsError(`model từ chối trả lời câu "${name}"`);
  if (a?.type !== type) throw new DecisionsError(`thiếu đáp án ${type} cho câu "${name}"`);
  return a as Extract<Answer, { type: T }>;
}

export function createDecisionsClient(opts: { apiKey: string; model: string }): DecisionsClient {
  if (!opts.apiKey) throw new Error("Thiếu OPENAI_API_KEY");
  // SDK tự retry 429/5xx/lỗi mạng; request Decisions không có side effect nên retry an toàn.
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 2, timeout: 20_000 });
  return {
    async ask(req) {
      const t0 = performance.now();
      let raw: unknown;
      try {
        raw = await client.decisions.create({
          model: opts.model,
          input: req.input,
          questions: req.questions,
          prompt_cache_key: req.cacheKey,
        });
      } catch (e) {
        throw new DecisionsError(e instanceof Error ? e.message : String(e));
      }
      return { ...parseResponse(req.questions, raw), latencyMs: Math.round(performance.now() - t0) };
    },
  };
}
