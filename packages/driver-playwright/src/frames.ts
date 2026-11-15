import type { Frame, Page } from "playwright";

export interface FrameInfo {
  frame: Frame;
  /** ["main"] hoặc ["main", "iframe[payment]", ...]. */
  path: string[];
}

function describe(frame: Frame): string {
  // frame.name() là attribute name, hoặc id nếu không có name.
  if (frame.name()) return `iframe[${frame.name()}]`;
  try {
    return `iframe[${new URL(frame.url()).host || frame.url()}]`;
  } catch {
    return "iframe";
  }
}

function pathOf(frame: Frame): string[] {
  const parent = frame.parentFrame();
  return parent ? [...pathOf(parent), describe(frame)] : ["main"];
}

/** Main frame + các iframe (cùng/khác origin) đang hiển thị trong viewport. */
export async function visibleFrames(page: Page): Promise<FrameInfo[]> {
  const viewport = page.viewportSize();
  const out: FrameInfo[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      out.push({ frame, path: ["main"] });
      continue;
    }
    if (frame.isDetached()) continue;
    // boundingBox tính theo viewport của main frame; null nếu iframe (hoặc cha nó) không hiển thị.
    const box = await frame.frameElement().then((el) => el.boundingBox()).catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    if (viewport && (box.y + box.height < 0 || box.y > viewport.height || box.x + box.width < 0 || box.x > viewport.width)) continue;
    out.push({ frame, path: pathOf(frame) });
  }
  return out;
}
