import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("fixtures/", import.meta.url));

/** Phục vụ thư mục fixtures trên một cổng ngẫu nhiên. Hai server = hai origin khác nhau. */
export async function serveFixtures(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/+/, "");
    if (name === "home") return res.writeHead(200, { "content-type": "text/html" }).end("<h1>Home</h1>");
    try {
      if (!/^[\w-]+\.html$/.test(name)) throw new Error("not found");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(DIR + name));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
