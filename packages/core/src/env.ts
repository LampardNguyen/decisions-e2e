import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** File bí mật riêng của dự án đang test, đặt ở `<project_dir>/.env.e2e` (nên gitignore). */
export const PROJECT_ENV_FILE = ".env.e2e";

/**
 * Env cho một session: `base` (env chung của repo decisions-e2e) cộng `<projectDir>/.env.e2e` nếu có;
 * biến của dự án ghi đè biến cùng tên. Không sửa `process.env`, nên các dự án không lẫn bí mật của nhau.
 */
export function withProjectEnv(projectDir: string | undefined, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!projectDir) return base;
  const file = join(projectDir, PROJECT_ENV_FILE);
  if (!existsSync(file)) return base;
  return { ...base, ...parseEnv(readFileSync(file, "utf8")) };
}
