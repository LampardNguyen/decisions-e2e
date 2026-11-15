import { expect, test } from "vitest";
import { parseTestFile, serializeTestFile, stepsOf } from "../src/index.js";

const SAMPLE = `---
name: shop-login-add-to-cart
url: https://staging.example.com
data:
  email: qa01@example.com
  password: "{{QA_PASSWORD}}"
---

## do: Đăng nhập bằng email và mật khẩu
## check: Đã đăng nhập, hiển thị tên tài khoản ở header
## do: Tìm "Áo thun" và thêm sản phẩm đầu tiên vào giỏ
## check: Giỏ hàng có 1 sản phẩm
## check: Header hiện số 1
`;

test("parse đúng ví dụ ở plan §10; check gắn vào do đứng trước", () => {
  const t = parseTestFile(SAMPLE);
  expect(t.name).toBe("shop-login-add-to-cart");
  expect(t.url).toBe("https://staging.example.com");
  expect(t.data).toEqual({ email: "qa01@example.com", password: "{{QA_PASSWORD}}" });
  expect(t.steps).toEqual([
    { do: "Đăng nhập bằng email và mật khẩu", check: ["Đã đăng nhập, hiển thị tên tài khoản ở header"] },
    { do: 'Tìm "Áo thun" và thêm sản phẩm đầu tiên vào giỏ', check: ["Giỏ hàng có 1 sản phẩm", "Header hiện số 1"] },
  ]);
  // data chung gắn vào mọi bước khi chạy
  expect(stepsOf(t).every((s) => s.data?.password === "{{QA_PASSWORD}}")).toBe(true);
});

test("serialize rồi parse lại giữ nguyên kịch bản", () => {
  const steps = [
    { do: "Đăng nhập", data: { user: "qa01", password: "{{QA_PASSWORD}}" }, check: ["Đã đăng nhập"] },
    { do: "Mở 'コンテンツ' rồi chọn '複製'", check: ["Form 基本情報: tên '1_coupon test'"] },
  ];
  const text = serializeTestFile({ name: "coupon duplicate", url: "https://x.test/a?b=1", steps });
  const t = parseTestFile(text);
  expect(t).toMatchObject({ name: "coupon duplicate", url: "https://x.test/a?b=1", data: { user: "qa01", password: "{{QA_PASSWORD}}" } });
  expect(t.steps.map((s) => [s.do, s.check])).toEqual(steps.map((s) => [s.do, s.check]));
});

test("lỗi rõ ràng khi file sai định dạng", () => {
  expect(() => parseTestFile("## do: x")).toThrow(/frontmatter/);
  expect(() => parseTestFile("---\nname: a\n---\n## do: x")).toThrow(/url/);
  expect(() => parseTestFile("---\nurl: http://x\n---\n## check: y")).toThrow(/sau một/);
  expect(() => parseTestFile("---\nurl: http://x\n---\n")).toThrow(/không có bước/);
});
