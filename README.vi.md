# decisions-e2e

[English](README.md) | **Tiếng Việt**

Test web E2E bằng ngôn ngữ tự nhiên từ Claude hoặc từ dòng lệnh. QA viết các bước (do) và kỳ vọng (check); công cụ tự điều khiển trình duyệt (Playwright), tự kiểm tra và chỉ trả về PASS/FAIL kèm thư mục kết quả. Việc chọn thao tác ở mỗi bước do OpenAI Decisions API (`/v1/decisions`, model `gpt-6-luna`) đảm nhận.

Trạng thái: M0–M3 xong (core, driver Playwright, MCP server, file test `.test.md`, CLI).

## Cài đặt

Yêu cầu Node ≥ 22.2.

```bash
npm install
npx playwright install chromium
npm run build
```

Tạo file `.env` ở thư mục repo (hoặc thư mục cha) theo `.env.example`:

```
OPENAI_API_KEY=sk-...
E2E_SECRET_QA_PASSWORD=...
```

## Đăng ký với Claude Code

```bash
claude mcp add decisions-e2e -- node /đường/dẫn/tuyệt/đối/decisions-e2e/packages/mcp-server/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "decisions-e2e": {
      "command": "node",
      "args": ["/đường/dẫn/tuyệt/đối/decisions-e2e/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Server tự đọc `.env` theo vị trí repo, không phụ thuộc thư mục đang đứng. Kết quả test ghi vào **thư mục dự án đang test** (`project_dir`), không ghi vào repo này.

## Dùng trong chat (cách tiết kiệm token)

Mở Claude **trong thư mục dự án cần test**, gửi cả test case một lần:

```
Dùng tool e2e_run của MCP decisions-e2e, gọi đúng MỘT lần, project_dir = thư mục làm việc hiện tại (đường dẫn tuyệt đối).
url: https://staging.example.com/login
steps:
1. do: "Đăng nhập bằng email và mật khẩu", data: {"email": "qa01@example.com", "password": "{{QA_PASSWORD}}"}, check: ["Header hiện tên tài khoản"]
2. do: "Tìm 'Áo thun' và thêm sản phẩm đầu tiên vào giỏ", check: ["Giỏ hàng có 1 sản phẩm"]
Chỉ báo lại PASS/FAIL, bước lỗi và lý do (nếu có), và run_dir. Không mở ảnh hay report.
```

`e2e_run` tự chạy hết các bước, dừng ở bước đầu tiên không đạt, chụp ảnh full page cuối, đóng trình duyệt và **chỉ trả text** (không ảnh):

```json
{ "passed": false, "failed_step": 2, "reason": "check không đạt (0.12): Giỏ hàng có 1 sản phẩm", "total_steps": 2, "run_dir": "...", "report": "...", "final_url": "..." }
```

## Tất cả tool

| Tool | Việc làm | Trả ảnh |
|---|---|---|
| `e2e_run` | Chạy trọn một test case trong một lần gọi | không |
| `e2e_run_test` | Chạy lại một file `.test.md` | không |
| `e2e_save_test` | Lưu các lệnh do/check đã chạy trong session thành `<project_dir>/e2e-tests/<name>.test.md` | không |
| `e2e_open` | Mở trình duyệt tại URL, trả `session_id` (dùng khi cần thao tác từng bước để dò lỗi) | có |
| `e2e_do` | Thực hiện một mục tiêu nhỏ; engine tự lặp quan sát → chọn thao tác → thực thi | có |
| `e2e_check` | Chấm các kỳ vọng đúng/sai trên trang hiện tại, kèm xác suất | có |
| `e2e_screenshot` | Chụp màn hình (viewport hoặc cả trang) | có |
| `e2e_snapshot` | Debug: bảng element engine đang thấy; `debug: true` liệt kê thêm text không thuộc element nào | không |
| `e2e_close` | Đóng trình duyệt, sinh `report.md` | không |

- Các tool từng bước (`e2e_open` → `e2e_do`/`e2e_check` → `e2e_close`) trả ảnh về Claude nên tốn token: chỉ dùng khi dò lỗi, rồi `e2e_save_test` để chạy lại bằng `e2e_run_test` hoặc CLI.
- `e2e_do` trả `done` **không** có nghĩa là pass — luôn xác nhận bằng check.
- Giá trị cần gõ truyền qua `data`. Bí mật viết `"{{NAME}}"` và đặt `E2E_SECRET_NAME` trong `.env`; giá trị thật không gửi lên OpenAI, không trả về Claude, không ghi trace hay file test.
- Mở dropdown và chọn mục trong dropdown nên nằm trong **cùng một** `do`: dropdown có thể tự đóng giữa hai lần gọi.
- Câu check nên mô tả thứ **nhìn thấy được** trên màn hình (tiêu đề form, giá trị field), không dựa vào tên thao tác vừa làm.
- `needs_input`: engine cần giá trị cho một ô nhưng `data` không có. `blocked`: gặp CAPTCHA/2FA hoặc không chắc chắn.
- Session tự đóng sau 30 phút không hoạt động.

## File test `.test.md`

```markdown
---
name: admin-login
url: https://staging.example.com/login
data:
  user: qa01
  password: "{{QA_PASSWORD}}"
---

## do: Đăng nhập bằng user và password
## check: Đã đăng nhập thành công, không còn form đăng nhập
## do: Bấm vào mục "Cài đặt" ở menu bên trái
## check: Trang cài đặt đang hiển thị
```

- `data` dùng chung cho mọi bước `do`. Mỗi `## check:` thuộc về `## do:` đứng ngay trước nó; một bước có thể có nhiều check.
- Fail ở bước nào thì dừng ở bước đó.

## CLI

Chạy không cần Claude (CI, chạy hàng loạt). Mặc định `--project-dir` là thư mục hiện tại.

```bash
npx decisions-e2e run e2e-tests/admin-login.test.md
npx decisions-e2e do --url https://staging.example.com --goal "Đăng nhập" --data email=qa01@example.com --data "password={{QA_PASSWORD}}" --check "Header hiện tên tài khoản"
```

In JSON kết quả giống `e2e_run`. Exit code: 0 = pass, 1 = fail, 2 = sai tham số. Chạy ngoài repo: `node /đường/dẫn/decisions-e2e/packages/cli/dist/index.js run ...` (hoặc `npm link` trong `packages/cli`).

## Kết quả mỗi lần chạy

```
<project_dir>/
  e2e-tests/<name>.test.md          file test đã lưu
  e2e-runs/<thời gian>_<session>/
    result.json    passed, bước lỗi, lý do, kịch bản đã chạy
    report.md      tóm tắt cho người đọc
    trace.json     mọi request/quyết định/xác suất (đã che bí mật)
    screenshots/
```

Nên thêm `e2e-runs/` vào `.gitignore` của dự án. Các tool từng bước gọi không kèm `project_dir` thì ghi vào `E2E_RUNS_DIR` (mặc định `<repo>/runs`).

## Cấu hình (env)

| Env | Mặc định | Ý nghĩa |
|---|---|---|
| `OPENAI_API_KEY` | (bắt buộc) | |
| `DECISIONS_MODEL` | `gpt-6-luna` | |
| `E2E_MAX_STEPS` | 25 | số bước tối đa mỗi `e2e_do` |
| `E2E_MAX_ELEMENTS` | 250 | số element tối đa gửi cho model |
| `E2E_MIN_CONFIDENCE` | 0.35 | dưới ngưỡng → `blocked` (giá trị tạm) |
| `E2E_CHECK_THRESHOLD` | 0.7 | ngưỡng pass của `e2e_check` |
| `E2E_STEP_SCREENSHOTS` | false | chụp ảnh sau mỗi bước |
| `E2E_RUNS_DIR` | `<repo>/runs` | chỉ dùng khi không truyền `project_dir` |
| `E2E_HEADED` | true | hiện cửa sổ trình duyệt |
| `E2E_SECRET_<NAME>` | — | giá trị cho `{{NAME}}` |

## Lưu ý về dữ liệu

Nội dung trang (text, danh sách element, screenshot khi `e2e_check`) được gửi lên OpenAI. Chỉ dùng với môi trường và tài khoản test. Secret gõ vào ô không phải password vẫn có thể hiện trong screenshot của `e2e_check`.

## Giới hạn

Chưa hỗ trợ: upload file, canvas, kéo-thả, popup/tab mới, cuộn trong vùng cuộn lồng nhau. Sau mỗi click, engine chờ trang và iframe con yên lặng ít nhất 1 giây (tối đa vài giây nếu trang liên tục gửi request nền), nên mỗi bước chậm hơn thao tác tay. Ảnh lớn hơn 1,5 MB không gửi kèm vào chat (chỉ trả đường dẫn file).

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md). Báo lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).

## Giấy phép

[MIT](LICENSE)

## Phát triển

```bash
npm test            # test offline, không cần API key
npm run typecheck
npm run probe       # gọi thật /v1/decisions, in response
npm run poc         # chạy do/check thật trên 4 fixture local
npm run smoke:mcp   # chạy MCP server thật qua stdio trên fixture login
```

Tài liệu: `docs/decisions-api-notes.md` (API đã xác minh), `docs/poc-results.md` (số liệu PoC).
