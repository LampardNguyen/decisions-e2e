import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Secrets, withProjectEnv } from "../src/index.js";

test("withProjectEnv: <project_dir>/.env.e2e bổ sung và ghi đè env chung, không sửa base", () => {
  const dir = mkdtempSync(join(tmpdir(), "de2e-env-"));
  writeFileSync(join(dir, ".env.e2e"), "E2E_SECRET_SHOP_PASSWORD=shop-pw\nE2E_SECRET_SHARED=project\n");
  const base = { E2E_SECRET_SHARED: "repo", E2E_SECRET_OTHER: "o" };
  const env = withProjectEnv(dir, base);
  expect(env).toMatchObject({ E2E_SECRET_SHOP_PASSWORD: "shop-pw", E2E_SECRET_SHARED: "project", E2E_SECRET_OTHER: "o" });
  expect(base).toEqual({ E2E_SECRET_SHARED: "repo", E2E_SECRET_OTHER: "o" });
  expect(new Secrets(env).resolve("{{SHOP_PASSWORD}}").text).toBe("shop-pw");
});

test("withProjectEnv: không có project_dir hoặc không có file thì giữ nguyên env chung", () => {
  const base = { E2E_SECRET_X: "x" };
  expect(withProjectEnv(undefined, base)).toBe(base);
  expect(withProjectEnv(mkdtempSync(join(tmpdir(), "de2e-env-")), base)).toBe(base);
});
