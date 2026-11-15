// PoC M1: chạy `do` + `check` THẬT (gọi Decisions API) trên fixture local, hoặc trên một URL bất kỳ.
//
//   npm run poc                         # 4 flow fixture, mỗi flow 1 lần
//   npm run poc -- --runs 3             # mỗi flow 3 lần
//   npm run poc -- --headed --url https://staging... --goal "Đăng nhập" \
//       --data '{"email":"qa@x.com","password":"{{QA_PASSWORD}}"}' --check "Đã đăng nhập"
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Session, createDecisionsClient, loadConfig, type DecisionsClient } from "@decisions-e2e/core";
import { PlaywrightDriver } from "@decisions-e2e/driver-playwright";
import { serveFixtures } from "../packages/driver-playwright/test/server.js";

for (const p of [".env", "../.env"]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    headed: { type: "boolean", default: false },
    url: { type: "string" },
    goal: { type: "string" },
    data: { type: "string" },
    check: { type: "string", multiple: true },
  },
});

interface Flow {
  name: string;
  url: string;
  goal: string;
  data?: Record<string, string>;
  /** [expectation, kết quả mong đợi] */
  checks: [string, boolean][];
}

const config = loadConfig();
const real = createDecisionsClient({ apiKey: config.apiKey, model: config.model });

async function runFlow(flow: Flow) {
  const stats = { requests: 0, tokens: 0, cached: 0, apiMs: 0 };
  const client: DecisionsClient = {
    async ask(req) {
      const r = await real.ask(req);
      stats.requests++;
      stats.tokens += r.usage.inputTokens;
      stats.cached += r.usage.cachedTokens;
      stats.apiMs += r.latencyMs;
      return r;
    },
  };
  const session = new Session(new PlaywrightDriver({ maxElements: config.maxElements }), client, config);
  const t0 = performance.now();
  try {
    await session.open(flow.url, { headed: args.headed });
    const result = await session.do(flow.goal, flow.data);
    const doMs = Math.round(performance.now() - t0);
    const doRequests = stats.requests;
    const checks = flow.checks.length ? await session.check(flow.checks.map(([e]) => e)) : [];
    const checksOk = checks.every((c, i) => c.passed === flow.checks[i]![1]);
    for (const s of result.steps) {
      const d = s.decision;
      console.log(
        `    ${s.step}. ${d.op} ${s.elementLabel ? `"${s.elementLabel}"` : ""}${d.valueKey ? ` ← ${d.valueKey}` : ""}${d.optionIndex ? ` option ${d.optionIndex}` : ""}` +
          ` conf=${d.confidence} ${d.latencyMs}ms${s.error ? ` ERROR ${s.error}` : ""}`,
      );
    }
    console.log(`    → ${result.status}: ${result.message}`);
    for (const c of checks) console.log(`    check "${c.expectation}" → p=${c.probability}`);
    return {
      flow: flow.name,
      ok: result.status === "done" && checksOk,
      status: result.status,
      checks: checks.map((c) => c.probability).join(" / "),
      steps: result.steps.length,
      requests: stats.requests,
      tokens: stats.tokens,
      cached: stats.cached,
      msPerStep: Math.round(doMs / Math.max(1, result.steps.length)),
      apiMsPerRequest: Math.round(stats.apiMs / Math.max(1, stats.requests)),
      doRequests,
      totalMs: Math.round(performance.now() - t0),
    };
  } finally {
    console.log(`    report: ${await session.close()}`);
  }
}

let flows: Flow[];
let stop = async () => {};
if (args.url && args.goal) {
  flows = [
    {
      name: "custom",
      url: args.url,
      goal: args.goal,
      data: args.data ? JSON.parse(args.data) : undefined,
      checks: (args.check ?? []).map((c) => [c, true]),
    },
  ];
} else {
  const [a, b] = await Promise.all([serveFixtures(), serveFixtures()]);
  stop = async () => void (await Promise.all([a.close(), b.close()]));
  process.env.E2E_SECRET_QA_PASSWORD = "s3cret-pw"; // mật khẩu của fixture login.html
  flows = [
    {
      name: "login",
      url: `${a.origin}/login.html`,
      goal: "Log in with the QA account",
      data: { email: "qa@example.com", password: "{{QA_PASSWORD}}" },
      checks: [
        ["The page shows a welcome message for qa@example.com", true],
        ["The page shows an error message about invalid credentials", false],
      ],
    },
    {
      name: "checkout-iframe",
      url: `${a.origin}/checkout.html?card=${encodeURIComponent(b.origin)}`,
      goal: "Fill in the full name, the order note and the card number, then pay",
      data: { full_name: "Nguyen Linh", note: "Leave at the door", card_number: "4242424242424242" },
      checks: [["The page confirms that the payment is complete", true]],
    },
    {
      name: "controls",
      url: `${a.origin}/controls.html`,
      goal: "Choose the country Japan, choose express delivery, set the city to Hue, then save",
      data: { city: "Hue" },
      checks: [["The page shows: Saved: country=jp speed=exp city=Hue", true]],
    },
    {
      name: "occluded",
      url: `${a.origin}/occluded.html`,
      goal: "Buy the product",
      checks: [["The page shows the text Bought", true]],
    },
  ];
}

const rows = [];
for (const flow of flows) {
  for (let i = 1; i <= Number(args.runs); i++) {
    console.log(`\n## ${flow.name} (lần ${i})`);
    try {
      rows.push(await runFlow(flow));
    } catch (e) {
      console.log(`    LỖI: ${e instanceof Error ? e.message : e}`);
      rows.push({ flow: flow.name, ok: false, status: "exception" });
    }
  }
}
await stop();
console.log("\n");
console.table(rows);
