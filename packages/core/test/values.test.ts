import { expect, test } from "vitest";
import { MissingSecret, Secrets } from "../src/index.js";

test("thay placeholder bằng env và che lại ở mọi nơi", () => {
  const s = new Secrets({ E2E_SECRET_PW: "hunter2" });
  expect(s.resolve("{{PW}}")).toEqual({ text: "hunter2", masked: "{{PW}}", secret: true });
  expect(s.resolve("plain")).toEqual({ text: "plain", masked: "plain", secret: false });
  expect(s.redact({ a: ["x hunter2 y"], b: { c: "hunter2" }, n: 1 })).toEqual({ a: ["x *** y"], b: { c: "***" }, n: 1 });
});

test("thiếu env → MissingSecret", () => {
  expect(() => new Secrets({}).resolve("{{PW}}")).toThrow(MissingSecret);
});
