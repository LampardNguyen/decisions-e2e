# Changelog

Mỗi task thêm một mục mới lên đầu file, dạng `## YYYY-MM-DD — <tên task>`.

## 2026-11-15 — Bí mật riêng từng dự án (.env.e2e)

- Engine đọc thêm `<project_dir>/.env.e2e` cho mỗi session có `project_dir` (`e2e_run`, `e2e_run_test`, `e2e_open`, CLI); biến ghi đè `.env` của repo, không lẫn giữa các dự án.
- Core: thêm `withProjectEnv` (`packages/core/src/env.ts`); `SessionManager` nhận `{ projectDir }` thay cho `{ runsDir }`.
- Test cho `withProjectEnv` và `e2e_run` dùng placeholder từ `.env.e2e`.
- Cập nhật README, README.vi, `.env.example`, skill `/e2e`, note `graphify/secrets-env.md`.

## 2026-11-15 — Skill /e2e cho Claude

- Thêm `skills/e2e/SKILL.md`: hướng dẫn Claude chia yêu cầu QA thành do/check, gọi `e2e_run` một lần, xử lý bí mật, dò lỗi từng bước và mẫu báo cáo bug.

## 2026-11-15 — Tài liệu mã nguồn mở (v0.1.0)

- Thêm README.md tiếng Anh; README cũ (tiếng Việt) chuyển thành README.vi.md.
- Thêm LICENSE (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, mẫu issue/PR trong `.github/`.
- Thêm CLAUDE.md (quy tắc làm việc) và bản đồ tri thức `graphify/`.
- `package.json`: version 0.1.0, license MIT.
- Dọn dữ liệu nội bộ (URL, tài khoản test, ghi chú handoff/report, script ví dụ coupon) trước khi công khai.

## 2026-11-15 — v0.1.0: các tính năng hiện có

- Engine core: vòng lặp observe → decide → act qua OpenAI Decisions API, `check` có xác suất, ngưỡng confidence, trạng thái `done` / `blocked` / `needs_input`.
- Driver Playwright: snapshot element tương tác xuyên iframe, bỏ phần tử bọc ngoài trùng nhãn, chờ trang và iframe yên sau click.
- MCP server stdio: `e2e_run`, `e2e_run_test`, `e2e_save_test`, `e2e_open`, `e2e_do`, `e2e_check`, `e2e_screenshot`, `e2e_snapshot`, `e2e_close`.
- File test `.test.md` và CLI `decisions-e2e` (`run`, `do`).
- Bí mật qua placeholder `{{NAME}}` / `E2E_SECRET_NAME`, không gửi lên API, không ghi ra file.
- Kết quả ghi vào `<project_dir>/e2e-runs/` của dự án đang test.
