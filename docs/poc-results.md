# Kết quả PoC (M1)

Ngày đo: 2026-11-14. Lệnh: `npm run poc -- --runs 3` (headless, Chromium của Playwright 1.65.1, model `gpt-6-luna`).

## Phạm vi đã đo

Chỉ mới đo trên **4 flow fixture local** (`packages/driver-playwright/test/fixtures`). **Chưa đo trên web staging thật** — cần URL và tài khoản test. Khi có, chạy:

```bash
npm run poc -- --headed --url <URL> --goal "<yêu cầu>" --data '{"email":"...","password":"{{QA_PASSWORD}}"}' --check "<kỳ vọng>"
```

(đặt `E2E_SECRET_QA_PASSWORD` trong `.env`).

## Kết quả trên fixture

Mỗi flow chạy 3 lần; một lần tính là thành công khi `do` trả `done` **và** mọi `check` khớp kỳ vọng.

| Flow | Nội dung | Thành công | Bước | Request | Token input / lần | Thời gian / bước | Tổng thời gian |
|---|---|---|---|---|---|---|---|
| login | gõ email, gõ mật khẩu (secret), bấm Log in | 3/3 | 3 | 7 | 6.852 | 1,27–1,39 s | 4,2–4,6 s |
| checkout-iframe | gõ ở main + iframe cùng origin + iframe khác origin, bấm Pay | 3/3 | 4 | 9 | 9.027 | 1,23–1,33 s | 5,4–5,9 s |
| controls | select native, radio, combobox autocomplete, Save | 3/3 | 5 | 9 | 8.148 | 1,03–1,11 s | 5,6–5,9 s |
| occluded | nút bị banner che → đóng banner → bấm lại | 3/3 | 3 | 5 | 3.990 | 0,87–0,89 s | 3,1 s |

- "Thời gian / bước" gồm cả snapshot, gọi API, thao tác và chờ trang ổn định. Riêng API: trung bình 354–429 ms mỗi request.
- Bước `TYPE_TEXT` và `SELECT` tốn 2 request (request phụ chọn `value_key` / option), nên chậm hơn bước `CLICK` (~0,7–0,9 s so với ~0,35–0,45 s phần API).
- Mỗi request khoảng 800–1.000 token → chi phí một flow dưới 0,001 USD (0,10 USD / 1M token).
- Ba lần chạy của cùng một flow cho quyết định và confidence **giống hệt nhau**.
- `check`: xác suất 1 cho các kỳ vọng đúng, 0 cho kỳ vọng sai (login: "hiện lỗi sai thông tin").

## Điều cần biết khi đọc số liệu

1. **Prompt đã được chỉnh dựa trên chính fixture này.** Lần chạy đầu, flow `controls` bị `blocked`: sau khi gõ "Hue" vào combobox, câu `click_target` chia gần đều giữa gợi ý "Hue" (0,45) và nút Save (0,42), confidence 0,31 < ngưỡng 0,35. Sau khi viết lại quy tắc về combobox trong `prompts.ts`, bước đó đạt confidence 0,93. Vì vậy 12/12 không phải là kiểm chứng độc lập — cần flow thật để biết tỉ lệ thành công thực tế.
2. **Cache chưa bao giờ trúng** (`cached_tokens` = 0 ở mọi request), kể cả request phụ dùng lại nguyên `input`. Lý do khả dĩ: input của fixture chỉ ~800–1.000 token, dưới ngưỡng 1.024 token. Chưa xác nhận được cache hoạt động với trang lớn hơn.
3. **Ngưỡng `E2E_MIN_CONFIDENCE` = 0,35 vẫn là tạm.** Trên fixture, các bước đúng có confidence 0,82–1,0; trường hợp duy nhất dưới ngưỡng là quyết định đúng nhưng sát nút (mục 1). Chưa có trường hợp nào chọn sai để biết ngưỡng có chặn được lỗi hay không.
4. **Screenshot thật chưa đo token riêng.** Request `check` (JSON + ảnh viewport 1280×800 của fixture gần như trống) nằm trong tổng token ở bảng.

## Hành vi đã xác nhận qua PoC

- Secret (`{{QA_PASSWORD}}`) được gõ vào trang nhưng không xuất hiện trong request hay `trace.json`.
- Thao tác bị che → ghi lỗi vào lịch sử, model tự chọn đóng banner rồi làm lại.
- Element trong iframe khác origin được chọn và thao tác như element thường.
