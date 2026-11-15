import type { Element, Op, Snapshot } from "./types.js";

export interface ContextInfo {
  path: string[];
  kind: "page" | "frame" | "native" | "webview";
  url?: string;
}

export interface DriverAction {
  op: Op;
  element?: Element;
  optionIndex?: string;
  text?: string;
  /** text là secret: driver phải che value của ô này trong các snapshot sau. */
  secret?: boolean;
}

export interface Driver {
  open(url: string, opts: { headed: boolean; viewport?: { width: number; height: number } }): Promise<void>;
  contexts(): Promise<ContextInfo[]>;
  snapshot(): Promise<Snapshot>;
  isFresh(s: Snapshot): Promise<boolean>;
  /** Ném StalePage nếu trang đã đổi so với snapshot; khi đó KHÔNG có thao tác nào được thực thi. */
  act(action: DriverAction, s: Snapshot): Promise<void>;
  waitForSettle(kind: "after_click" | "after_type" | "explicit"): Promise<void>;
  screenshot(path: string, opts?: { fullPage?: boolean }): Promise<void>;
  currentUrl(): Promise<string | null>;
  /** Tuỳ chọn, để gỡ lỗi: mô tả các đoạn text đang hiển thị nhưng không thuộc element nào trong snapshot. */
  debugUnlisted?(): Promise<string>;
  close(): Promise<void>;
}

/** Trang đã đổi kể từ snapshot — không có thao tác nào được thực thi. */
export class StalePage extends Error {
  constructor(message = "Page changed since the snapshot; no action was executed") {
    super(message);
    this.name = "StalePage";
  }
}

/** Element đích bị phần tử khác che — không click. */
export class Occluded extends Error {
  constructor(message = "Target element is covered by another element; no action was executed") {
    super(message);
    this.name = "Occluded";
  }
}
