const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;

export class MissingSecret extends Error {
  constructor(name: string) {
    super(`Thiếu biến môi trường E2E_SECRET_${name} cho placeholder {{${name}}}`);
    this.name = "MissingSecret";
  }
}

export interface ResolvedValue {
  /** Giá trị thật để gõ — không bao giờ rời khỏi máy trừ khi gõ vào trang. */
  text: string;
  /** Dạng an toàn để ghi trace / trả về Claude. */
  masked: string;
  secret: boolean;
}

/** Giữ các giá trị secret đã dùng trong session để che khỏi mọi thứ gửi đi hoặc ghi ra. */
export class Secrets {
  private values = new Set<string>();

  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  /** Thay `{{NAME}}` bằng env `E2E_SECRET_NAME`. */
  resolve(template: string): ResolvedValue {
    let secret = false;
    const text = template.replace(PLACEHOLDER, (_, name: string) => {
      const v = this.env[`E2E_SECRET_${name}`];
      if (v === undefined || v === "") throw new MissingSecret(name);
      secret = true;
      this.values.add(v);
      return v;
    });
    return { text, masked: template, secret };
  }

  /** Thay mọi lần xuất hiện của secret đã dùng bằng `***` (cả trong chuỗi con của object). */
  redact<T>(value: T): T {
    if (this.values.size === 0) return value;
    if (typeof value === "string") {
      let out: string = value;
      for (const s of this.values) out = out.split(s).join("***");
      return out as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.redact(v)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.redact(v)])) as T;
    }
    return value;
  }
}

export function isSecretTemplate(template: string): boolean {
  return new RegExp(PLACEHOLDER.source).test(template);
}
