import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { describeElement, parseTestFile, runScenario, serializeTestFile, stepsOf, type SessionManager } from "@decisions-e2e/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const MAX_INLINE_IMAGE_BYTES = 1.5 * 1024 * 1024;
const log = (...args: unknown[]) => console.error("[decisions-e2e]", ...args); // stdout dành cho giao thức MCP

/** Kết quả tool: JSON gọn + ảnh PNG (nếu có và không quá lớn). */
function result(data: Record<string, unknown>, screenshotPath?: string): CallToolResult {
  const content: CallToolResult["content"] = [];
  if (screenshotPath) {
    const png = readFileSync(screenshotPath);
    if (png.length <= MAX_INLINE_IMAGE_BYTES) {
      content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
    } else {
      data = { ...data, note: "Ảnh lớn hơn 1,5 MB nên không gửi kèm; mở file ở đường dẫn screenshot." };
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }, ...content] };
}

/** Bọc handler: log ra stderr, lỗi trả về dạng isError thay vì làm sập server. */
function tool<A>(name: string, handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    const t0 = Date.now();
    try {
      const r = await handler(args);
      log(name, "ok", `${Date.now() - t0}ms`);
      return r;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(name, "error", message);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
}

const sessionId = z.string().describe("session_id do e2e_open trả về");

/** Thư mục kết quả nằm trong dự án đang test: <project_dir>/e2e-runs. */
const projectDir = z
  .string()
  .refine(isAbsolute, "project_dir phải là đường dẫn tuyệt đối")
  .describe("Đường dẫn TUYỆT ĐỐI tới thư mục dự án đang test (thường là thư mục làm việc hiện tại). Kết quả ghi vào <project_dir>/e2e-runs/; bí mật {{NAME}} đọc thêm từ <project_dir>/.env.e2e.");
/** Tên file an toàn từ tên test: giữ chữ (mọi ngôn ngữ), số, - và _. */
const slug = (name: string) => name.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "test";

export function createServer(sessions: SessionManager): McpServer {
  const server = new McpServer({ name: "decisions-e2e", version: "0.0.0" });

  server.registerTool(
    "e2e_run",
    {
      description:
        "CÁCH DÙNG ƯU TIÊN: chạy trọn một test case trong MỘT lần gọi. Server tự mở trình duyệt, lần lượt thực hiện từng bước (do), kiểm tra kỳ vọng (check), " +
        "dừng ở bước đầu tiên không đạt, chụp ảnh full page cuối cùng, đóng trình duyệt và ghi report. " +
        "KHÔNG trả ảnh: chỉ trả passed/failed, bước lỗi, lý do và run_dir (trong <project_dir>/e2e-runs/). Đừng mở ảnh hay report trừ khi người dùng yêu cầu. " +
        "Giá trị cần gõ truyền qua `data`; bí mật viết dạng \"{{NAME}}\" (lấy từ biến môi trường E2E_SECRET_NAME), không bao giờ truyền mật khẩu thật.",
      inputSchema: {
        project_dir: projectDir,
        url: z.string().url(),
        steps: z
          .array(
            z.object({
              do: z.string().min(1).describe("Mục tiêu của bước, viết như lời QA"),
              data: z.record(z.string(), z.string()).optional(),
              check: z.array(z.string().min(1)).optional().describe("Kỳ vọng phải đạt sau bước này"),
              max_steps: z.number().int().min(1).max(100).optional(),
            }),
          )
          .min(1),
        headed: z.boolean().optional(),
        threshold: z.number().min(0).max(1).optional().describe("Ngưỡng pass của check (mặc định 0.7)"),
      },
    },
    tool("e2e_run", async ({ project_dir, url, steps, headed, threshold }) => {
      const r = await runScenario(sessions.spawn({ projectDir: project_dir }), url, steps, { headed, threshold });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 1) }] };
    }),
  );

  server.registerTool(
    "e2e_open",
    {
      description:
        "Mở trình duyệt tại một URL và bắt đầu phiên test E2E. Trả về session_id dùng cho các tool e2e_* khác, kèm screenshot. " +
        "Trình duyệt mặc định hiện cửa sổ (headed) để QA có thể thao tác tay khi cần (CAPTCHA, 2FA).",
      inputSchema: {
        url: z.string().url(),
        project_dir: projectDir.optional(),
        headed: z.boolean().optional().describe("Hiện cửa sổ trình duyệt (mặc định theo E2E_HEADED, thường là true)"),
        viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
      },
    },
    tool("e2e_open", async ({ url, project_dir, headed, viewport }) => {
      const session = sessions.add({ projectDir: project_dir });
      try {
        const opened = await session.open(url, { headed, viewport });
        return result({ session_id: session.id, final_url: opened.url, screenshot: opened.screenshotPath }, opened.screenshotPath);
      } catch (e) {
        await sessions.close(session.id).catch(() => {});
        throw e;
      }
    }),
  );

  server.registerTool(
    "e2e_do",
    {
      description:
        "Thực hiện một mục tiêu bằng ngôn ngữ tự nhiên trên trang hiện tại (engine tự quan sát → chọn thao tác → thực thi, lặp tới khi xong). " +
        "Mỗi lần gọi nên là MỘT mục tiêu nhỏ (một flow con), ví dụ \"Đăng nhập\" hoặc \"Thêm sản phẩm đầu tiên vào giỏ\". " +
        "Giá trị cần gõ phải truyền qua `data` (engine không tự bịa giá trị); bí mật viết dạng \"{{NAME}}\" để lấy từ biến môi trường E2E_SECRET_NAME — không bao giờ truyền mật khẩu thật. " +
        "status: done = engine cho rằng đã xong; blocked = không tiến triển được; needs_input = thiếu giá trị cho ô ở missing_field (hỏi người dùng rồi gọi lại với data bổ sung); max_steps; error. " +
        "QUAN TRỌNG: `done` KHÔNG phải bằng chứng pass — sau đó hãy gọi e2e_check để xác nhận.",
      inputSchema: {
        session_id: sessionId,
        instruction: z.string().min(1).describe("Mục tiêu cần đạt, viết như lời QA"),
        data: z.record(z.string(), z.string()).optional().describe('Giá trị để nhập, ví dụ {"email":"qa@x.com","password":"{{QA_PASSWORD}}"}'),
        max_steps: z.number().int().min(1).max(100).optional(),
      },
    },
    tool("e2e_do", async ({ session_id, instruction, data, max_steps }) => {
      const r = await sessions.get(session_id).do(instruction, data, max_steps);
      return result(
        {
          status: r.status,
          message: r.message,
          final_url: r.finalUrl,
          screenshot: r.screenshotPath,
          ...(r.missingField && { missing_field: r.missingField }),
          steps: r.steps.map((s) => ({
            step: s.step,
            op: s.decision.op,
            ...(s.elementLabel !== undefined && { element: s.elementLabel }),
            ...(s.typedValueMasked !== undefined && { value: s.typedValueMasked }),
            confidence: s.decision.confidence,
            page_changed: s.pageChanged,
            ...(s.error && { error: s.error }),
          })),
        },
        r.screenshotPath,
      );
    }),
  );

  server.registerTool(
    "e2e_check",
    {
      description:
        "Kiểm tra các kỳ vọng trên trang hiện tại (dựa vào screenshot + text đang hiển thị). Mỗi kỳ vọng là một mệnh đề đúng/sai, ví dụ \"Header hiển thị tên tài khoản qa01\". " +
        "Trả về passed và probability (0–1) cho từng kỳ vọng; passed = probability ≥ threshold.",
      inputSchema: {
        session_id: sessionId,
        expectations: z.array(z.string().min(1)).min(1).max(400),
        threshold: z.number().min(0).max(1).optional().describe("Ngưỡng pass (mặc định 0.7)"),
      },
    },
    tool("e2e_check", async ({ session_id, expectations, threshold }) => {
      const session = sessions.get(session_id);
      const results = await session.check(expectations, threshold);
      const screenshot = results[0]?.screenshotPath;
      return result(
        {
          passed: results.every((r) => r.passed),
          results: results.map((r) => ({ expectation: r.expectation, passed: r.passed, probability: r.probability, threshold: r.threshold })),
          final_url: await session.url(),
          screenshot,
        },
        screenshot,
      );
    }),
  );

  server.registerTool(
    "e2e_screenshot",
    {
      description: "Chụp màn hình trang hiện tại của session.",
      inputSchema: { session_id: sessionId, full_page: z.boolean().optional().describe("Chụp cả trang thay vì chỉ viewport") },
    },
    tool("e2e_screenshot", async ({ session_id, full_page }) => {
      const session = sessions.get(session_id);
      const path = await session.screenshot(full_page);
      return result({ final_url: await session.url(), screenshot: path }, path);
    }),
  );

  server.registerTool(
    "e2e_snapshot",
    {
      description:
        "Debug: liệt kê bảng element đánh số mà engine đang thấy trên trang (role, nhãn, giá trị, trạng thái, iframe). " +
        "Với debug=true: liệt kê thêm các đoạn text ngắn đang hiển thị nhưng KHÔNG thuộc element nào (ứng viên bị engine bỏ sót), kèm tag/class/cursor của nó và các phần tử cha.",
      inputSchema: { session_id: sessionId, debug: z.boolean().optional() },
    },
    tool("e2e_snapshot", async ({ session_id, debug }) => {
      const session = sessions.get(session_id);
      const s = await session.snapshot();
      const lines = [
        `url: ${s.url}`,
        `title: ${s.title}`,
        `elements: ${s.elements.length}${s.truncated ? " (đã cắt bớt)" : ""}`,
        ...s.elements.map((e) => `${describeElement(e)}${e.ops.length ? ` · ops: ${e.ops.join(",")}` : ""}`),
      ];
      if (debug) lines.push("", "--- Text hiển thị KHÔNG thuộc element nào (text, rồi chuỗi node từ trong ra ngoài) ---", await session.debugUnlisted());
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  );

  server.registerTool(
    "e2e_save_test",
    {
      description:
        "Lưu các lệnh do/check đã chạy trong session thành file test <project_dir>/e2e-tests/<name>.test.md để chạy lại bằng e2e_run_test hoặc CLI. " +
        "Chỉ lưu đúng những gì đã chạy; check gọi trước mọi do bị bỏ qua.",
      inputSchema: {
        session_id: sessionId,
        project_dir: projectDir,
        name: z.string().min(1).describe("Tên test, cũng là tên file"),
        overwrite: z.boolean().optional().describe("Ghi đè nếu file đã tồn tại (mặc định false)"),
      },
    },
    tool("e2e_save_test", async ({ session_id, project_dir, name, overwrite }) => {
      const { url, steps } = sessions.get(session_id).recorded;
      if (!url || !steps.length) throw new Error("Session chưa có lệnh do nào để lưu");
      const dir = join(project_dir, "e2e-tests");
      const file = join(dir, `${slug(name)}.test.md`);
      if (existsSync(file) && !overwrite) throw new Error(`File đã tồn tại: ${file} (truyền overwrite: true để ghi đè)`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, serializeTestFile({ name, url, steps }));
      return { content: [{ type: "text", text: JSON.stringify({ file, steps: steps.length }, null, 1) }] };
    }),
  );

  server.registerTool(
    "e2e_run_test",
    {
      description:
        "Chạy lại một file .test.md trong MỘT lần gọi (giống e2e_run). KHÔNG trả ảnh: chỉ trả passed/failed, bước lỗi, lý do và run_dir trong <project_dir>/e2e-runs/. " +
        "Đừng mở ảnh hay report trừ khi người dùng yêu cầu.",
      inputSchema: {
        project_dir: projectDir,
        file: z.string().min(1).describe("Đường dẫn file .test.md: tuyệt đối, hoặc tương đối so với project_dir"),
        headed: z.boolean().optional(),
        threshold: z.number().min(0).max(1).optional(),
      },
    },
    tool("e2e_run_test", async ({ project_dir, file, headed, threshold }) => {
      const path = resolve(project_dir, file);
      const test = parseTestFile(readFileSync(path, "utf8"));
      const r = await runScenario(sessions.spawn({ projectDir: project_dir }), test.url, stepsOf(test), { headed, threshold });
      return { content: [{ type: "text", text: JSON.stringify({ test: test.name || path, ...r }, null, 1) }] };
    }),
  );

  server.registerTool(
    "e2e_close",
    {
      description: "Đóng trình duyệt của session và sinh báo cáo. Trả về đường dẫn report.md (cùng thư mục có trace.json và screenshots).",
      inputSchema: { session_id: sessionId },
    },
    tool("e2e_close", async ({ session_id }) => ({ content: [{ type: "text", text: JSON.stringify({ report: await sessions.close(session_id) }, null, 1) }] })),
  );

  return server;
}
