# graphify — bản đồ tri thức decisions-e2e (MOC)

Chỉ mục gốc. Mỗi chức năng một note, liên kết bằng `[[tên-note]]`. Xem quy tắc trong `CLAUDE.md`.

## Note

- [[secrets-env]] — bí mật `{{NAME}}`: nạp env (repo `.env` + `<project_dir>/.env.e2e`), thay giá trị, che khỏi output

## Gói chính (để định hướng)

- `packages/core` — engine, check, session, scenario, `.test.md`
- `packages/driver-playwright` — driver trình duyệt, `page/snapshot.js`
- `packages/mcp-server` — MCP stdio server, các tool `e2e_*`
- `packages/cli` — lệnh `decisions-e2e`
