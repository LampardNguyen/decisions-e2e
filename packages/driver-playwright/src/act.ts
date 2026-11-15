import { Occluded, StalePage, type DriverAction } from "@decisions-e2e/core";
import type { ElementHandle, Frame, Page } from "playwright";

const TIMEOUT = { timeout: 3000 };
// Các loại input này cần giá trị đúng định dạng một lần, không gõ từng phím được.
const FILL_ONLY = new Set(["date", "datetime-local", "month", "time", "week", "number"]);

/** Thực thi một thao tác lên node `nodeId` trong `frame`. Người gọi đã kiểm tra freshness. */
export async function actOnElement(frame: Frame, nodeId: number, action: DriverAction): Promise<void> {
  const node = (await frame.evaluateHandle(`window.__de2e?.get(${nodeId})`)).asElement() as ElementHandle<HTMLElement> | null;
  if (!node) throw new StalePage();

  switch (action.op) {
    case "CLICK":
      if (await frame.evaluate(`window.__de2e.occluded(${nodeId})`)) throw new Occluded();
      await node.click(TIMEOUT);
      return;
    case "TYPE_TEXT": {
      const text = action.text ?? "";
      if (FILL_ONLY.has((await node.getAttribute("type")) ?? "")) {
        await node.fill(text, TIMEOUT);
      } else {
        // Xoá nội dung cũ rồi gõ từng phím để autocomplete nhận đủ sự kiện bàn phím.
        await node.fill("", TIMEOUT);
        await node.type(text, TIMEOUT);
      }
      if (action.secret) await frame.evaluate(`window.__de2e.markSecret(${nodeId})`);
      return;
    }
    case "SELECT":
      await node.selectOption({ index: Number(action.optionIndex) }, TIMEOUT);
      return;
    case "PRESS_ENTER":
      await node.press("Enter", TIMEOUT);
      return;
    default:
      throw new Error(`Thao tác ${action.op} không cần element`);
  }
}

export async function scroll(page: Page, direction: "up" | "down"): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  // Đặt chuột giữa màn hình để cuộn đúng vùng cuộn chính (SPA thường cuộn trong một container, không phải body).
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, (direction === "down" ? 1 : -1) * vp.height * 0.8);
}
