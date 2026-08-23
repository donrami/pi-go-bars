/**
 * Unit tests for the billing + dashboard parsers.
 *
 * Run:  node --test extensions/pi-go-bars/core.test.ts
 *
 * These exercise the pure parsing functions only — no network, no fs, no
 * config. Fixtures live in ./testdata and are sanitised (no real Stripe IDs).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import { parseBilling, parseDashboard, formatUsd, loadConfig, discoverOpencodeKey, parseUsageApi } from "./core.ts";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "testdata", name), "utf-8");

// ─── parseBilling ────────────────────────────────────────────────────────────

test("parseBilling: real SSR object → $20.00 / $0.00 / $50.00", () => {
  const data = parseBilling(fixture("billing.html"));
  assert.equal(data.error, undefined);
  assert.equal(data.balanceUsd, 19.9996075);   // 1999960750 / 1e8
  assert.equal(data.monthlyUsageUsd, 0.0003925); // 39250 / 1e8
  assert.equal(data.monthlyLimitUsd, 50);        // whole USD, no division
  assert.equal(data.autoReload, true);
  assert.equal(data.reloadAmountUsd, 10);
  assert.equal(data.reloadTriggerUsd, 5);
  assert.equal(typeof data.fetchedAt, "number");
});

test("parseBilling: formatted values match the browser dashboard", () => {
  const data = parseBilling(fixture("billing.html"));
  assert.equal(formatUsd(data.balanceUsd), "$20.00");
  assert.equal(formatUsd(data.monthlyUsageUsd), "$0.00");
  assert.equal(formatUsd(data.monthlyLimitUsd), "$50.00");
});

test("parseBilling: decoy balance field must NOT match (regex tightening)", () => {
  // A page with an unrelated `balance:`/`monthlyLimit:` object but no
  // `customerID:"cus_..."` billing object. Before tightening, the loose
  // regex would have returned balance $5 / limit $100 (the decoy values).
  // After tightening it must error WITHOUT adopting the decoy values.
  //
  // The page contains billing-ish keywords so `looksLikeBilling` is true,
  // which means the error is "parser may be outdated" — the correct signal
  // for "the page looks like billing but the object anchor is gone."
  const data = parseBilling(fixture("decoy-balance.html"));
  assert.equal(data.balanceUsd, 0,   "must not adopt decoy balance of $5");
  assert.equal(data.monthlyLimitUsd, 0, "must not adopt decoy limit of $100");
  assert.equal(data.autoReload, false);
  assert.ok(data.error, "expected an error rejecting the decoy page");
});

test("parseBilling: login/redirect page → 'no billing data on page'", () => {
  const data = parseBilling(fixture("login-redirect.html"));
  assert.equal(data.balanceUsd, 0);
  assert.ok(data.error);
  assert.match(data.error!, /no billing data on page/);
});

test("parseBilling: SSR-shape-changed page (looks like billing, no object) → parser-outdated", () => {
  // Has the billing keywords (so looksLikeBilling is true) but the
  // customerID:"cus_..." anchor is gone → parser-rot error, not silent $0.
  const html =
    '<div>monthlyLimit:50 monthlyUsage:0 balance:2000000000</div>' +
    '<script>window.x={monthlyLimit:50}</script>';
  const data = parseBilling(html);
  assert.ok(data.error);
  assert.match(data.error!, /parser may be outdated/);
});

test("parseBilling: nested object in billing body is handled (depth scan)", () => {
  // The real billing object nests `lite:$R[27]={useBalance:!0}`. A flat
  // [^}]* scan would truncate at the inner brace; the depth-counting
  // extractor must reach the outer closing brace and still find monthlyLimit.
  const html =
    '$R[25]={customerID:"cus_TEST",balance:1500000000,reload:!1,' +
    'reloadAmount:10,reloadTrigger:5,monthlyLimit:20,monthlyUsage:0,' +
    'lite:$R[27]={useBalance:!0}}';
  const data = parseBilling(html);
  assert.equal(data.error, undefined);
  assert.equal(data.balanceUsd, 15);
  assert.equal(data.monthlyLimitUsd, 20);
  assert.equal(data.autoReload, false);
});

// ─── parseDashboard (regression guard for the Go path) ───────────────────────

test("parseDashboard: missing SSR windows → parser-outdated error", () => {
  const html =
    '<html><body>rollingUsage weeklyUsage monthlyUsage</body></html>';
  const data = parseDashboard(html);
  assert.equal(data.rolling, null);
  assert.equal(data.weekly, null);
  assert.equal(data.monthly, null);
  assert.ok(data.error);
  assert.match(data.error!, /parser may be outdated/);
});

test("parseDashboard: valid SSR hydration objects parse to windows", () => {
  const html =
    'rollingUsage:$R[2]={usagePercent:42,resetInSec:3600} ' +
    'weeklyUsage:$R[3]={resetInSec:604800,usagePercent:17} ' +
    'monthlyUsage:$R[4]={usagePercent:8,resetInSec:2592000}';
  const data = parseDashboard(html);
  assert.equal(data.error, undefined);
  assert.equal(data.rolling?.usagePercent, 42);
  assert.equal(data.rolling?.resetInSec, 3600);
  assert.equal(data.weekly?.usagePercent, 17);
  assert.equal(data.weekly?.resetInSec, 604800);
  assert.equal(data.monthly?.usagePercent, 8);
  assert.equal(data.monthly?.resetInSec, 2592000);
});

// ─── formatUsd ───────────────────────────────────────────────────────────────

test("formatUsd: rounds to 2 decimals, prefixes $", () => {
  assert.equal(formatUsd(19.9996075), "$20.00");
  assert.equal(formatUsd(0.004), "$0.00");
  assert.equal(formatUsd(0.005), "$0.01"); // toFixed rounds half up
  assert.equal(formatUsd(1234.5), "$1234.50");
  assert.equal(formatUsd(NaN), "$0.00");
  assert.equal(formatUsd(Infinity), "$0.00");
});

// ─── showZen opt-in (default off) ─────────────────────────────────────────────

test("loadConfig: showZen defaults to false / undefined when not set", () => {
  // No creds in env and no config file in the test cwd → null config.
  // (Guarded with a temp dir so a real ~/.pi/agent/pi-go-bars.json on the
  // dev machine doesn't leak into the test result.)
  const tmp = path.join(__dirname, "testdata", "empty-config.json");
  const saved = { ...process.env };
  delete process.env.OPENCODE_GO_WORKSPACE_ID;
  delete process.env.OPENCODE_GO_AUTH_COOKIE;
  delete process.env.OPENCODE_GO_SHOW_ZEN;
  try {
    const cfg = loadConfig(tmp);
    assert.equal(cfg, null);
  } finally {
    process.env = saved;
  }
});

test("loadConfig: env OPENCODE_GO_SHOW_ZEN=1 opts in to Zen billing", () => {
  const saved = { ...process.env };
  process.env.OPENCODE_GO_WORKSPACE_ID = "wrk_TEST";
  process.env.OPENCODE_GO_AUTH_COOKIE = "Fe26.2**test";
  try {
    process.env.OPENCODE_GO_SHOW_ZEN = "1";
    assert.equal(loadConfig()?.showZen, true);
    process.env.OPENCODE_GO_SHOW_ZEN = "false";
    assert.equal(loadConfig()?.showZen, false);
    process.env.OPENCODE_GO_SHOW_ZEN = "yes";
    assert.equal(loadConfig()?.showZen, true);
    delete process.env.OPENCODE_GO_SHOW_ZEN;
    assert.equal(loadConfig()?.showZen, false);
  } finally {
    process.env = saved;
  }
});

// ─── Official usage API (dual-mode primary) ─────────────────────────────────

test("discoverOpencodeKey: reads key from opencode auth.json", () => {
  const tmp = path.join(__dirname, "testdata", "auth.json");
  fs.writeFileSync(tmp, JSON.stringify({
    "opencode-go": { type: "api", key: "sk-test-123" },
    "anthropic": { type: "api", key: "sk-ant-other" },
  }));
  const saved = { ...process.env };
  process.env.OPENCODE_AUTH_JSON = tmp;
  try {
    assert.equal(discoverOpencodeKey(), "sk-test-123");
  } finally {
    delete process.env.OPENCODE_AUTH_JSON;
    process.env = saved;
    fs.rmSync(tmp, { force: true });
  }
});

test("parseUsageApi: converts API response to GoUsageData windows", () => {
  const data = parseUsageApi({
    usage: {
      rolling: { status: "ok", percent: 42, resetsAt: "2026-08-24T00:00:00.000Z" },
      weekly: { status: "ok", percent: 60, resetsAt: "2026-08-25T00:00:00.000Z" },
      monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-30T00:00:00.000Z" },
    },
  });
  assert.equal(data.rolling?.usagePercent, 42);
  assert.equal(data.monthly?.usagePercent, 100);
  assert.equal(typeof data.rolling?.resetInSec, "number");
  assert.ok(data.rolling && data.rolling.resetInSec > 0);
  assert.equal(data.error, undefined);
});

test("parseUsageApi: invalid response shape yields error, not throw", () => {
  const data = parseUsageApi(null);
  assert.match(data.error ?? "", /invalid response/);
  const partial = parseUsageApi({ usage: {} });
  assert.equal(partial.rolling, null);
});
