# secrets-env — bí mật `{{NAME}}` và env theo dự án

## Mục đích

Cho phép test dùng mật khẩu, token qua placeholder `{{NAME}}` mà giá trị thật không bao giờ rời khỏi máy. Giá trị không gửi lên OpenAI, không trả về Claude, không ghi ra trace, report hay file `.test.md`. Mỗi dự án đang test có thể có bí mật riêng.

## File chính

- `packages/core/src/env.ts`: `withProjectEnv(projectDir, base)` gộp `<projectDir>/.env.e2e` lên trên env chung, không sửa `process.env`.
- `packages/core/src/values.ts`: `Secrets.resolve` thay `{{NAME}}` bằng `E2E_SECRET_NAME`, ném `MissingSecret` nếu thiếu. `Secrets.redact` thay mọi giá trị đã dùng bằng `***`.
- `packages/core/src/session.ts`: `Session` nhận `env` và tạo `Secrets(env)`. `SessionManager` nhận factory `(opts?: { projectDir? }) => Session`.
- `packages/mcp-server/src/index.ts`: nạp `.env` của repo vào `process.env` lúc khởi động. Factory tính `runsDir = <projectDir>/e2e-runs` và `env = withProjectEnv(projectDir)`.
- `packages/cli/src/index.ts`: tương tự, `projectDir` mặc định là cwd.

## Luồng xử lý

1. Khi khởi động, server hoặc CLI nạp `<repo>/.env` (hoặc `<repo>/../.env`) vào `process.env`. File này chứa `OPENAI_API_KEY` và bí mật dùng chung.
2. Tool có `project_dir` gọi `sessions.add` hoặc `spawn({ projectDir })`, factory sinh `Session` với env đã gộp `.env.e2e`. Đọc file mỗi lần tạo session, nên sửa file có hiệu lực ngay, không cần khởi động lại.
3. `do` hoặc `data` chứa `{{NAME}}` thì `Secrets.resolve` lấy giá trị thật để gõ vào trang, đồng thời ghi nhớ giá trị đó để `redact`.
4. Mọi snapshot, trace, kết quả trả về đều qua `redact`.

## Phụ thuộc

- `node:util` `parseEnv` (Node ≥ 22).
- Config (`loadConfig`) vẫn đọc từ `process.env`, nên biến cấu hình như `E2E_MAX_STEPS` trong `.env.e2e` **không** có tác dụng. Chỉ `E2E_SECRET_*` được dùng.

## Lưu ý / bẫy

- Bí mật trùng chuỗi con của text khác sẽ làm output bị che lẫn, ví dụ `staging.***.com`. Đây là hành vi đúng.
- Bí mật gõ vào ô không phải password vẫn có thể hiện trong screenshot gửi khi check.
- Tool từng bước gọi không kèm `project_dir` chỉ thấy `.env` của repo.
- Nhắc người dùng thêm `.env.e2e` vào `.gitignore` của dự án.

## Liên quan

- [[index]]
