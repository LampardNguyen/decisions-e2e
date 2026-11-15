// File test .test.md (plan §10): frontmatter (name, url, data) + các dòng "## do:" / "## check:" theo thứ tự.
// Parser tự viết, chỉ hỗ trợ đúng định dạng này (không phải YAML đầy đủ).
import type { ScenarioStep } from "./scenario.js";

export interface TestFile {
  name: string;
  url: string;
  /** Giá trị nhập dùng chung cho mọi bước do. Bí mật viết dạng "{{NAME}}". */
  data: Record<string, string>;
  steps: ScenarioStep[];
}

const unquote = (v: string) => {
  v = v.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v[0] === '"' ? JSON.parse(v) : v.slice(1, -1);
  return v;
};

export function parseTestFile(text: string): TestFile {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("File test phải bắt đầu bằng frontmatter (dòng ---)");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Frontmatter thiếu dòng --- đóng");

  const meta: Record<string, string> = {};
  const data: Record<string, string> = {};
  let inData = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`Không hiểu dòng frontmatter: ${line}`);
    const [, indent, key, value] = m as unknown as [string, string, string, string];
    if (indent && inData) data[key] = unquote(value);
    else if (!indent) {
      inData = key === "data" && !value.trim();
      if (!inData) meta[key] = unquote(value);
    } else throw new Error(`Dòng thụt lề ngoài khối data: ${line}`);
  }
  if (!meta.url) throw new Error("Frontmatter thiếu url");

  const steps: ScenarioStep[] = [];
  for (const line of lines.slice(end + 1)) {
    const m = /^##\s*(do|check):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, kind, body] = m as unknown as [string, "do" | "check", string];
    if (kind === "do") steps.push({ do: body.trim() });
    else {
      const last = steps.at(-1);
      if (!last) throw new Error(`"## check:" phải đứng sau một "## do:": ${line}`);
      (last.check ??= []).push(body.trim());
    }
  }
  if (!steps.length) throw new Error('File test không có bước "## do:" nào');
  return { name: meta.name ?? "", url: meta.url, data, steps };
}

const quote = (v: string) => (/^[\w@.\-/]*$/.test(v) && v !== "" ? v : JSON.stringify(v));

/** Gộp data của các bước thành data chung (bước sau ghi đè bước trước nếu trùng key). */
export function serializeTestFile(t: { name: string; url: string; steps: ScenarioStep[] }): string {
  const data: Record<string, string> = {};
  for (const s of t.steps) Object.assign(data, s.data);
  const out = ["---", `name: ${quote(t.name)}`, `url: ${t.url}`];
  if (Object.keys(data).length) out.push("data:", ...Object.entries(data).map(([k, v]) => `  ${k}: ${quote(v)}`));
  out.push("---", "");
  for (const s of t.steps) {
    out.push(`## do: ${s.do.replace(/\n/g, " ")}`);
    for (const c of s.check ?? []) out.push(`## check: ${c.replace(/\n/g, " ")}`);
  }
  return out.join("\n") + "\n";
}

/** Bước để chạy: data chung gắn vào mọi bước do. */
export function stepsOf(t: TestFile): ScenarioStep[] {
  return t.steps.map((s) => ({ ...s, ...(Object.keys(t.data).length && { data: { ...t.data, ...s.data } }) }));
}
