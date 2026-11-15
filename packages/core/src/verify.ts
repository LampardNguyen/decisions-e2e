import { readFileSync } from "node:fs";
import { SCREENSHOT_LABEL, VERIFY } from "./decisions/prompts.js";
import { requireAnswer } from "./decisions/client.js";
import { ask, type RunContext } from "./loop.js";
import type { CheckResult } from "./types.js";

/** Đánh giá các expectation trên trang hiện tại bằng MỘT request (mỗi expectation là một predicate). */
export async function runCheck(
  ctx: RunContext,
  expectations: string[],
  threshold = ctx.config.checkThreshold,
): Promise<CheckResult[]> {
  const screenshotPath = ctx.trace.screenshotPath("check");
  await ctx.driver.screenshot(screenshotPath);
  const snap = await ctx.driver.snapshot();
  const image = `data:image/png;base64,${readFileSync(screenshotPath).toString("base64")}`;

  const result = await ask(ctx, {
    input: [
      { role: "developer", content: VERIFY },
      {
        role: "user",
        content: [
          { type: "input_json", data: { url: snap.url, title: snap.title, visible_text: snap.visibleText } },
          // Thiếu nhãn này thì câu hỏi về ảnh bị chấm sai (docs/decisions-api-notes.md).
          { type: "input_text", text: SCREENSHOT_LABEL },
          { type: "input_image", image_url: image },
        ],
      },
    ],
    questions: expectations.map((e, i) => ({ type: "predicate", name: `check_${i + 1}`, instructions: e })),
  });

  const results = expectations.map((expectation, i) => {
    const { probability } = requireAnswer(result, `check_${i + 1}`, "predicate");
    return { expectation, passed: probability >= threshold, probability, threshold, screenshotPath };
  });
  ctx.trace.event("check", { results });
  ctx.trace.save();
  return results;
}
