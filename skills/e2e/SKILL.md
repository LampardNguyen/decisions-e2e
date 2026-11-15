---
name: e2e
description: Chạy test E2E web bằng ngôn ngữ tự nhiên qua MCP "decisions-e2e" (tool e2e_run, e2e_run_test, e2e_save_test và các tool dò lỗi từng bước). Dùng khi người dùng muốn test một luồng trên web, chạy lại file .test.md, lưu test case, hoặc gọi /e2e. Skill hướng dẫn chia yêu cầu QA thành các bước do/check, gọi e2e_run đúng MỘT lần để tiết kiệm token, xử lý bí mật bằng placeholder {{NAME}}, và báo cáo PASS/FAIL theo mẫu bug.
---

# /e2e: test E2E web qua MCP decisions-e2e

Mục tiêu: Claude chỉ **soạn kịch bản và gọi tool**. MCP server và engine tự điều khiển trình duyệt, tự kiểm tra, rồi chỉ trả về text ngắn. Claude **không** xem ảnh, không đọc report, trừ khi người dùng yêu cầu dò lỗi.

Trả lời người dùng bằng ngôn ngữ họ đang dùng (mặc định tiếng Việt).

## 1. Chọn cách chạy

| Người dùng muốn | Tool | Ghi chú |
|---|---|---|
| Test một luồng mô tả bằng lời | `e2e_run` | **Mặc định.** Gọi đúng một lần |
| Chạy lại file `.test.md` | `e2e_run_test` | `file` tương đối với `project_dir` |
| Lưu thành file test | `e2e_run` → nếu PASS, xem mục 5 | |
| Dò lỗi vì sao fail | Tool từng bước (mục 6) | Tốn token, chỉ khi được yêu cầu |

## 2. Thông tin bắt buộc

- **`project_dir`**: đường dẫn **tuyệt đối** của dự án đang test, mặc định là thư mục làm việc hiện tại. Kết quả ghi vào `<project_dir>/e2e-runs/`. Không dùng thư mục của repo decisions-e2e.
- **`url`**: trang bắt đầu. Nếu thiếu thì hỏi người dùng, không đoán.
- **Dữ liệu nhập** (email, user, từ khoá…): đưa vào `data`. Nếu thiếu giá trị cần gõ thì hỏi một lần, gộp mọi câu hỏi lại.

Hỏi gộp một lần các thông tin còn thiếu, rồi chạy luôn.

## 3. Chia yêu cầu thành bước `do` / `check`

Mỗi bước gồm `do` (một mục tiêu nhỏ), `data` (tuỳ chọn) và `check` (danh sách kỳ vọng).

Quy tắc viết `do`:
- Mỗi `do` là **một luồng con** có kết quả nhìn thấy được: đăng nhập, mở menu X, tìm Y. Không gộp cả kịch bản vào một `do`, cũng không tách nhỏ tới từng cú click.
- **Mở dropdown và chọn mục phải nằm trong cùng một `do`**, vì dropdown có thể tự đóng giữa hai lần gọi.
- Ghi nguyên văn nhãn trên giao diện, kể cả tiếng Nhật, trong dấu nháy: `Bấm 'クーポン一覧'`.
- Nêu vị trí khi dễ nhầm: "ở menu bên trái", "ở dòng tên 'ABC', cột 操作".
- Với thao tác có thể gây thay đổi dữ liệu mà người dùng không yêu cầu, ghi rõ giới hạn: "Dừng ngay sau khi chọn; không sửa field, không lưu, không submit, không xoá."

Quy tắc viết `check`:
- Mô tả thứ **nhìn thấy được** trên màn hình: tiêu đề, form, giá trị field, số dòng, thông báo.
- Không dựa vào tên thao tác vừa làm. Ví dụ, sau khi bấm 複製 có thể không có chữ 複製 nào hiện ra; nên check "form 基本情報 hiển thị với tên 'ABC'".
- Mỗi bước nên có ít nhất một check. `do` trả `done` **không** có nghĩa là pass.
- Mỗi check là một khẳng định ngắn, không gộp nhiều ý bằng "và" nếu có thể tách.

## 4. Bí mật

- Mật khẩu, token, OTP cố định… **luôn** viết dạng placeholder: `"password": "{{QA_PASSWORD}}"`. Server lấy giá trị thật từ `E2E_SECRET_QA_PASSWORD`, ưu tiên file `<project_dir>/.env.e2e` của dự án đang test, sau đó tới `.env` của decisions-e2e. Mỗi trang hoặc tài khoản dùng một tên riêng, ví dụ `{{SHOP_PASSWORD}}` hay `{{ADMIN_PASSWORD}}`.
- **Không bao giờ** gõ giá trị bí mật thật vào tool call, file test hay câu trả lời. Không đọc hay in nội dung `.env` hoặc `.env.e2e`.
- Nếu người dùng dán mật khẩu thật vào chat: không dùng nó. Hãy bảo họ tự thêm dòng `E2E_SECRET_<NAME>=...` vào `<project_dir>/.env.e2e`, nhắc thêm `.env.e2e` vào `.gitignore` của dự án, rồi dùng `{{NAME}}`.
- Lỗi `Thiếu biến môi trường E2E_SECRET_X`: báo người dùng thêm biến đó vào `<project_dir>/.env.e2e`. Không tự tạo file với giá trị bí mật.
- Output có dạng `staging.***.com` (khi bí mật trùng một phần chuỗi khác) là do engine che bí mật. Đây là hành vi đúng, không phải lỗi.

## 5. Gọi `e2e_run`

Ví dụ:

```json
{
  "project_dir": "/abs/path/to/project",
  "url": "https://staging.example.com/login",
  "steps": [
    { "do": "Đăng nhập bằng email và mật khẩu",
      "data": { "email": "qa01@example.com", "password": "{{QA_PASSWORD}}" },
      "check": ["Header hiện tên tài khoản, không còn form đăng nhập"] },
    { "do": "Tìm 'Áo thun' và thêm sản phẩm đầu tiên vào giỏ",
      "check": ["Giỏ hàng có 1 sản phẩm"] }
  ]
}
```

- Gọi **một lần**. Không gọi lại tự động khi fail, trừ khi người dùng yêu cầu.
- Kết quả có dạng: `{ passed, failed_step, reason, total_steps, run_dir, report, final_url }`.
- Một lần chạy mất khoảng vài chục giây tới vài phút, vì mỗi click phải chờ trang yên. Không cần báo tiến độ.

**Lưu thành file test**: nếu người dùng muốn lưu, tự viết file `<project_dir>/e2e-tests/<slug>.test.md` theo định dạng dưới đây. Cách khác là chạy bằng tool từng bước rồi gọi `e2e_save_test`. Không ghi đè file đã có nếu chưa được đồng ý.

```markdown
---
name: shop-login
url: https://staging.example.com/login
data:
  email: qa01@example.com
  password: "{{QA_PASSWORD}}"
---

## do: Đăng nhập bằng email và mật khẩu
## check: Header hiện tên tài khoản, không còn form đăng nhập
```

`data` dùng chung cho mọi bước. Mỗi `## check:` thuộc về `## do:` đứng ngay trước nó.

## 6. Dò lỗi từng bước (chỉ khi được yêu cầu)

1. `e2e_open` với `url` và `project_dir`, nhận `session_id`.
2. `e2e_do` từng bước. Trạng thái trả về có thể là:
   - `done`: xong thao tác, vẫn cần check;
   - `needs_input`: thiếu giá trị trong `data`, hỏi người dùng;
   - `blocked`: gặp CAPTCHA, 2FA hoặc engine không chắc chắn. Dừng lại và báo người dùng. Không tự vượt CAPTCHA.
3. `e2e_check` để chấm kỳ vọng.
4. Khi engine chọn sai element: dùng `e2e_snapshot` (`debug: true` liệt kê thêm text không thuộc element nào) để xem engine thấy gì, rồi viết lại `do` cụ thể hơn.
5. Sửa xong thì `e2e_save_test`, rồi `e2e_close`.

Các tool từng bước trả ảnh nên tốn token. Hạn chế `e2e_screenshot`, và chỉ chụp khi người dùng muốn xem.

## 7. Báo cáo

**PASS** (ngắn gọn):

```
✅ PASS — <tên test case> (<total_steps> bước)
Kết quả: <run_dir>
```

**FAIL**, theo mẫu bug để QA dán vào tracker:

```
❌ FAIL tại bước <failed_step>/<total_steps>

**Tiêu đề:** <mô tả ngắn lỗi>
**URL bắt đầu:** <url>   **URL cuối:** <final_url>
**Bước tái hiện:**
1. <do 1>
2. <do 2>
…
**Kỳ vọng:** <check của bước lỗi>
**Thực tế:** <reason>
**Bằng chứng:** <run_dir>/screenshots/, <run_dir>/report.md
```

- Không mở ảnh hay `report.md` để báo cáo. Chỉ đưa đường dẫn.
- Nếu `reason` cho thấy lỗi do kịch bản chứ không phải lỗi sản phẩm, nói rõ đó là **nghi lỗi kịch bản** và đề xuất cách viết lại `do`/`check`. Dấu hiệu: check viết sai tiền đề, chọn nhầm menu, trang còn đang tải.

## 8. Giới hạn hiện tại

Engine chưa hỗ trợ: upload file, canvas, kéo-thả, popup/tab mới, cuộn trong vùng cuộn lồng nhau. Nếu kịch bản cần các thao tác này, báo trước cho người dùng thay vì chạy.

Nội dung trang và screenshot khi check được gửi lên OpenAI. Chỉ dùng với môi trường và tài khoản test. Nếu URL trông như production, xác nhận với người dùng trước khi chạy.
