# Decisions API — ghi chú xác minh (M0)

Ngày xác minh: 2026-11-14. Nguồn:

- Reference: https://developers.openai.com/api/reference/resources/decisions/methods/create
- Guide: https://developers.openai.com/api/docs/guides/decisions
- Gọi thật: `npm run probe` (`scripts/probe-decisions.ts`), SDK `openai@7.57.0`

Ký hiệu: **[ref]** = ghi trong reference/guide, **[probe]** = quan sát khi gọi thật.

## Endpoint & SDK

- `POST https://api.openai.com/v1/decisions`, `Authorization: Bearer $OPENAI_API_KEY`, `Content-Type: application/json`. [ref]
- SDK Node: `client.decisions.create({...})` — có trong `openai@7.57.0`. [probe] Tài liệu không ghi phiên bản tối thiểu.
- Model: chỉ `gpt-6-luna`. [ref]

## Request body

| Field | Kiểu | Ghi chú |
|---|---|---|
| `model` | string | bắt buộc |
| `input` | string \| mảng item | bắt buộc; string ≤ 10.485.760 ký tự; mảng ≤ 131.072 item |
| `questions` | mảng | bắt buộc; **1–400**; answers trả về đúng thứ tự |
| `prompt_cache_key` | string \| null | ≤ 64 ký tự |
| `prompt_cache_options` | `{mode, ttl}` \| null | `mode`: `implicit` (mặc định) \| `explicit`; `ttl`: chỉ `"30m"` |
| `safety_identifier` | string \| null | ≤ 128 ký tự |

Không có `metadata`, `store`, `temperature`, `reasoning`...

### `input` (mảng message)

- `role: "user"` — `content` là string hoặc mảng part (≤ 16.384):
  - `{type: "input_text", text, prompt_cache_breakpoint?}`
  - `{type: "input_image", image_url, detail?, prompt_cache_breakpoint?}` — `image_url` khớp `^(data:|https?://)`; `detail`: `low` \| `high` \| `auto` (mặc định) \| `original`. Không hỗ trợ `file_id`.
  - `{type: "input_json", data}` — `data` là object hoặc mảng object. Giới hạn: **32 tầng lồng, 10.000 giá trị, 256 KiB** JSON compact UTF-8. Không có `prompt_cache_breakpoint`.
- `role: "developer"` / `"system"` — chỉ text (string hoặc mảng `input_text`).
- `role: "assistant"` — `output_text` / `refusal`. Ngoài ra có item `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output` (không dùng trong dự án này).

### `questions[]`

Chung: `type`, `name` (tuỳ chọn), `instructions` (string ≤ 1.048.576 ký tự, hoặc mảng 1–16.384 part `input_text` / `input_image` / `input_json`).

| `type` | Field riêng | Giới hạn |
|---|---|---|
| `predicate` | — | |
| `choice` | `choices: [{value, description?}]` | **2–255**, mỗi choice phải duy nhất; `value` là string hoặc boolean |
| `score` | `levels: [{label, description?}]` | 2–10, xếp thấp → cao |

## Response

```jsonc
{
  "model": "gpt-6-luna",
  "answers": [
    { "type": "predicate", "name": "is_login_page", "probability": 1 },
    { "type": "choice", "name": "operation", "choice": "TYPE_TEXT",
      "probabilities": [{ "value": "CLICK", "probability": 0.01 }, ...], "confidence": 0.97 },
    { "type": "score", "name": "...", "score": 1.1,
      "probabilities": [{ "value": 0, "label": "...", "probability": 0.2 }, ...], "confidence": 0.8 },
    { "type": "refusal", "name": "..." }
  ],
  "usage": {
    "input_tokens": 883,
    "input_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 },
    "output_tokens": 0,
    "output_tokens_details": { "reasoning_tokens": 0 },
    "total_tokens": 883
  }
}
```

- `predicate` chỉ có `probability`, **không có `confidence`**. [ref][probe]
- `choice`/`score` có `confidence`; tài liệu không định nghĩa thang đo. Trong probe: phân bố 0.98/0.01/0/0.01 cho `confidence` 0.97; phân bố 1/0 cho 1. [probe]
- `probabilities` của `choice` trả đủ mọi choice, đúng thứ tự khai báo, làm tròn 2 chữ số, tổng ≈ 1. [probe]
- Câu không có `name` → answer có `"name": null`. [probe] → luôn đặt `name` và ghép theo thứ tự.
- `refusal` chỉ có `{type, name}`, không kèm lý do. [ref]
- **`refusal` xuất hiện khi giả định của câu hỏi sai, không chỉ vì nội dung nhạy cảm.** [probe, 2026-11-14, trang login thật] Câu `click_target` ("Assume the next operation is CLICK...") bị từ chối ổn định (5/5 lần) khi form còn trống — lúc đó thao tác đúng là `TYPE_TEXT`. Cùng câu đó, khi form đã điền, trả lời nút ログイン với confidence 1. Thêm choice `NONE` thì model chọn `NONE` (0,77) thay vì từ chối. Đổi goal sang tiếng Anh hay bỏ ô password khỏi bảng element không làm hết từ chối. → Engine giữ refusal theo từng câu và chỉ báo lỗi khi câu bị từ chối là câu của op đã chọn (`requireAnswer`).
- `score` (trung bình có trọng số của index level, có thể lẻ) — chỉ từ [ref], probe chưa gọi loại này vì dự án không dùng.

## Lỗi [probe]

HTTP 400, body:

```json
{ "error": { "message": "Invalid 'questions[0].choices': array too short. ...",
             "type": "invalid_request_error", "param": "questions[0].choices",
             "code": "array_below_min_length" } }
```

Chưa quan sát lỗi 429/5xx; client vẫn retry 429/503 theo plan.

## Giới hạn & hiệu năng

- Rate limit của key này (đọc từ header `x-ratelimit-*`): **10.000 request/phút, 10.000.000 token/phút**. [probe] Có thể khác theo tài khoản.
- Latency: 520–580 ms cho request 5 câu hỏi + 1 ảnh, 883 token (`openai-processing-ms` ≈ 190–250). Lần gọi đầu tiên 1.642 ms. [probe] Chỉ 3 lần đo — chưa đủ để coi là số liệu thống kê.
- Token: ảnh PNG 64×64 ≈ 400 token, 512×512 ≈ 650 token ở `detail` `low`/`auto`/`high` (không thấy khác biệt giữa các mức với ảnh nhỏ). [probe] Chưa đo với screenshot viewport thật → đo ở M1.
- Kích thước/số lượng ảnh tối đa: tài liệu không ghi, chưa đo.
- Giá: $0,10 / 1M token input chưa cache; output không tính phí. [ref]

## Cache

- Breakpoint ngầm ở cuối `input`; prefix dùng lại phải ≥ 1.024 token; nội dung `questions` không tính vào prefix. [ref]
- `cached_tokens` và `cache_write_tokens` đã nằm trong `input_tokens`. [ref]
- Probe gọi 2 lần liên tiếp với cùng `input` (883 token) → `cached_tokens: 0`, đúng như dự đoán vì dưới 1.024 token. [probe] **Chưa xác nhận được cache hit** với input ≥ 1.024 token → kiểm tra ở M1 khi có snapshot thật.

## Quan sát ảnh hưởng tới thiết kế

1. **Phải gắn nhãn cho ảnh.** Cùng một ảnh đỏ đặc 64×64:
   - Đặt ảnh ngay sau `input_json` (không có text giới thiệu), hỏi "The attached image is mostly red." → `probability` **0.07**.
   - Thêm part `input_text` "Screenshot of the current page (attached image):" trước ảnh và hỏi "The attached screenshot image is mostly red." → **1**.
   - Ảnh đứng một mình với text "Look at the image." → **1**.

   Hai thứ đổi cùng lúc (nhãn và câu hỏi) nên chưa tách được nguyên nhân chính xác, nhưng với `check` (§7 plan): luôn đặt một `input_text` giới thiệu screenshot ngay trước `input_image`.
2. **Câu target cần ≥ 2 choices.** Chỉ có 1 element ứng viên thì không gửi câu hỏi đó (API trả 400).
3. **Quyết định phụ thuộc nhau phải tách request** (guide). → `value_key` và `select_option` là request phụ, dùng lại nguyên `input`.
