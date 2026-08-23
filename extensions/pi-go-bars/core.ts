/**
 * Core module for Opencode Go usage bars.
 *
 * Fetches usage by scraping the Opencode Go dashboard HTML and parsing
 * SolidJS SSR hydration output for `rollingUsage`, `weeklyUsage`, and
 * `monthlyUsage` (each with `usagePercent` and `resetInSec`).
 *
 * Auth: workspace ID + auth cookie. Config via env vars (preferred),
 * `.env` file in current working directory (auto-detected),
 * `~/.pi/agent/pi-go-bars.json`, or legacy opencode-go-usage config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Logger ──────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(os.tmpdir(), "pi", "pi-go-bars.log");

/**
 * Append a timestamped error entry to the extension log file.
 * Silently ignores logger failures (last resort).
 */
export function logError(context: string, err: unknown): void {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ts = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    fs.appendFileSync(LOG_FILE, `[${ts}] [${context}] ${msg}\n`, { flag: "a" });
  } catch {
    // last-resort silent fail
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoUsageWindow {
  usagePercent: number;
  resetInSec: number;
}

export interface GoUsageData {
  rolling: GoUsageWindow | null;
  weekly: GoUsageWindow | null;
  monthly: GoUsageWindow | null;
  error?: string;
  stale?: boolean;
  warning?: string;
  fetchedAt?: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG_FILE = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "pi-go-bars.json",
);

export interface GoBarsConfig {
  workspaceId: string;
  authCookie: string;
  /**
   * Official opencode-go API key (from `opencode-go` in opencode's
   * auth.json, or set explicitly). When present, usage comes from
   * `GET /zen/go/v1/usage` instead of the dashboard scrape.
   */
  apiKey?: string;
  /**
   * Opt-in: also scrape the workspace /billing page and render the Zen
   * pay-as-you-go balance + monthly spend segment. Default false so an
   * upgrade never changes behaviour for existing Go-only users.
   */
  showZen?: boolean;
}

function isString(val: unknown): val is string {
  return typeof val === "string";
}

/**Truthy check for env-style flags: "1"/"true"/"yes"/"on" (case-insensitive).*/
function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Parse a .env file and extract workspace credentials.
 * Supports KEY=value and KEY="value" formats. Zero dependencies.
 *
 * LIMITATION: Does NOT handle escaped quotes (\") or inline comments.
 * This is acceptable for the expected credential format but may misparse
 * general .env files.
 */
export function loadEnvFile(filePath: string): GoBarsConfig | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/);
    let workspaceId = "";
    let authCookie = "";
    let apiKey = "";
    let showZen = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key === "OPENCODE_GO_WORKSPACE_ID" && value) {
        workspaceId = value;
      } else if (key === "OPENCODE_GO_AUTH_COOKIE" && value) {
        authCookie = value;
      } else if (key === "OPENCODE_GO_API_KEY" && value) {
        apiKey = value;
      } else if (key === "OPENCODE_GO_SHOW_ZEN") {
        showZen = isTruthyFlag(value);
      }
    }

    if (workspaceId && authCookie) {
      return { workspaceId, authCookie, apiKey: apiKey || undefined, showZen } as GoBarsConfig;
    }
    if (apiKey) {
      return { workspaceId: "", authCookie: "", apiKey, showZen } as GoBarsConfig;
    }
  } catch (err) {
    logError("config:loadEnvFile", err);
  }
  return null;
}

/**
 * Load config from env vars → .env file → JSON file → legacy paths.
 * Env vars always take priority when present.
 */
export function loadConfig(configFile = DEFAULT_CONFIG_FILE): GoBarsConfig | null {
  const envWs = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const envCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  const envKey = process.env.OPENCODE_GO_API_KEY?.trim();
  if (envWs && envCookie) {
    return {
      workspaceId: envWs,
      authCookie: envCookie,
      apiKey: envKey || undefined,
      showZen: isTruthyFlag(process.env.OPENCODE_GO_SHOW_ZEN),
    } as GoBarsConfig;
  }
  if (envKey) {
    return {
      workspaceId: "",
      authCookie: "",
      apiKey: envKey,
      showZen: isTruthyFlag(process.env.OPENCODE_GO_SHOW_ZEN),
    } as GoBarsConfig;
  }

  // 1.5) .env file in current working directory (convenience for dev)
  const envFile = loadEnvFile(path.join(process.cwd(), ".env"));
  if (envFile) return envFile;

  // 2) Our own config file
  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ws = isString(parsed.workspaceId) ? parsed.workspaceId.trim() : "";
    const cookie = isString(parsed.authCookie) ? parsed.authCookie.trim() : "";
    const key = isString(parsed.apiKey) ? parsed.apiKey.trim() : "";
    if (ws && cookie) {
      const showZen = parsed.showZen === true;
      return { workspaceId: ws, authCookie: cookie, apiKey: key || undefined, showZen } as GoBarsConfig;
    }
    if (key) {
      return { workspaceId: "", authCookie: "", apiKey: key, showZen: parsed.showZen === true } as GoBarsConfig;
    }
  } catch (err) {
    logError("config:loadJson", err);
  }

  // 3) Legacy: opencode-go-usage plugin config
  const legacyPaths = [
    path.join(os.homedir(), ".config", "opencode", "opencode-go-usage.json"),
    path.join(os.homedir(), ".opencode", "opencode-go-usage.json"),
  ];
  for (const lp of legacyPaths) {
    try {
      const raw = fs.readFileSync(lp, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const ws = isString(parsed.workspaceId) ? parsed.workspaceId.trim() : "";
      const cookie = isString(parsed.authCookie) ? parsed.authCookie.trim() : "";
      if (ws && cookie) {
        return { workspaceId: ws, authCookie: cookie } as GoBarsConfig;
      }
    } catch (err) {
      logError("config:loadJson", err);
    }
  }

  return null;
}

/**
 * Write config to the default JSON file with restricted permissions.
 * Returns true on success.
 */
export function writeConfig(config: GoBarsConfig, configFile = DEFAULT_CONFIG_FILE): boolean {
  try {
    const dir = path.dirname(configFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${configFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, configFile);
    return true;
  } catch (err) {
    logError("config:write", err);
    return false;
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Cache TTL: 1.5 minutes.
 * Polling interval is 30 seconds, so 2 of 3 polls hit cached data
 * without a network request. Cache also guards concurrent/duplicate requests.
 */
const CACHE_TTL_MS = 90 * 1000;
const CACHE_FILE = path.join(os.tmpdir(), "pi", "pi-go-bars-cache.json");

interface CacheEntry<T> {
  data: T;
  ts: number;
}

/**
 * Generic JSON cache reader. `context` tags log entries so per-callers stay
 * distinguishable ("cache:read" vs "billingCache:read").
 */
function readCacheFile<T>(file: string, context: string): CacheEntry<T> | null {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry?.data && typeof entry.ts === "number") return entry;
  } catch (err) {
    logError(`${context}:read`, err);
  }
  return null;
}

/**
 * Atomic JSON cache write: tmp file + chmod 600 + rename, so a crash never
 * leaves a half-written cache. Mirrors the pattern used for config files.
 */
function writeCacheFile<T>(file: string, data: T, context: string): void {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ data, ts: Date.now() }));
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    logError(`${context}:write`, err);
  }
}

const CACHE_CONTEXT = "cache";
function readCache(): CacheEntry<GoUsageData> | null {
  return readCacheFile<GoUsageData>(CACHE_FILE, CACHE_CONTEXT);
}
function writeCache(data: GoUsageData): void {
  writeCacheFile(CACHE_FILE, data, CACHE_CONTEXT);
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

const AUTH_JSON_CANDIDATES = [
  ...(process.env.OPENCODE_AUTH_JSON ? [process.env.OPENCODE_AUTH_JSON] : []),
  path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
  path.join(os.homedir(), ".config", "opencode", "auth.json"),
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const USAGE_API_URL = "https://opencode.ai/zen/go/v1/usage";
const SCRAPE_TIMEOUT_MS = 10_000;

/** Regex for SolidJS SSR hydration output. Field order may vary. */
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

function windowRegex(name: string) {
  return [
    new RegExp(
      String.raw`${name}:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`,
    ),
    new RegExp(
      String.raw`${name}:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`,
    ),
  ];
}

const [RE_ROLLING_PCT, RE_ROLLING_RST] = windowRegex("rollingUsage");
const [RE_WEEKLY_PCT, RE_WEEKLY_RST] = windowRegex("weeklyUsage");
const [RE_MONTHLY_PCT, RE_MONTHLY_RST] = windowRegex("monthlyUsage");

function parseWindow(
  html: string,
  rePct: RegExp,
  reRst: RegExp,
): GoUsageWindow | null {
  let m = rePct.exec(html);
  if (m) {
    const usagePercent = Number(m[1]);
    const resetInSec = Number(m[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }
  m = reRst.exec(html);
  if (m) {
    const resetInSec = Number(m[1]);
    const usagePercent = Number(m[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }
  return null;
}

/**
 * Check if HTML contains dashboard-specific SSR hydration data.
 * Used to detect silent regex failures when SSR format changes.
 * Does NOT check for broad keywords that could match a login page.
 */
function looksLikeDashboard(html: string): boolean {
  return html.includes("rollingUsage") || html.includes("weeklyUsage") || html.includes("monthlyUsage");
}

export function parseDashboard(html: string): GoUsageData {
  const rolling = parseWindow(html, RE_ROLLING_PCT, RE_ROLLING_RST);
  const weekly = parseWindow(html, RE_WEEKLY_PCT, RE_WEEKLY_RST);
  const monthly = parseWindow(html, RE_MONTHLY_PCT, RE_MONTHLY_RST);

  // Parser health check: if all three windows are null but HTML looks valid,
  // the SSR format may have changed.
  if (!rolling && !weekly && !monthly && looksLikeDashboard(html)) {
    return {
      rolling: null,
      weekly: null,
      monthly: null,
      error: "parser may be outdated — update pi-go-bars",
      fetchedAt: Date.now(),
    };
  }

  return { rolling, weekly, monthly, fetchedAt: Date.now() };
}

export async function fetchUsage(config: GoBarsConfig): Promise<GoUsageData> {
  const url = DASHBOARD_URL(config.workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        Cookie: `auth=${config.authCookie}`,
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    // Guard against redirect-to-login: the final URL must contain the workspace path
    const finalUrl = resp.url;
    if (!finalUrl.includes(`/workspace/${config.workspaceId}/go`)) {
      throw new Error("Session expired or auth invalid — refresh your cookie");
    }

    const html = await resp.text();
    return parseDashboard(html);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Official usage API (dual-mode primary) ─────────────────────────────────

/**
 * Discover the opencode-go API key from opencode's own auth.json
 * (`~/.local/share/opencode/auth.json`, `~/.config/opencode/auth.json`).
 */
export function discoverOpencodeKey(): string | null {
  const envFile = process.env.OPENCODE_AUTH_JSON;
  const candidates = envFile ? [envFile, ...AUTH_JSON_CANDIDATES] : AUTH_JSON_CANDIDATES;
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const entry = parsed["opencode-go"];
      if (entry && typeof entry === "object") {
        const key = (entry as Record<string, unknown>).key;
        if (typeof key === "string" && key.trim()) return key.trim();
      }
    } catch (err) {
      logError("discover:authJson", err);
    }
  }
  return null;
}

/**
 * Parse the official usage API response:
 * { usage: { rolling: {status,percent,resetsAt}, weekly, monthly } }.
 * `resetsAt` is an ISO timestamp; converted to `resetInSec` to match the
 * scrape path's shape so rendering code is shared.
 */
export function parseUsageApi(json: unknown): GoUsageData {
  const empty: GoUsageData = { rolling: null, weekly: null, monthly: null, fetchedAt: Date.now() };
  if (!json || typeof json !== "object") {
    return { ...empty, error: "usage API returned an invalid response" };
  }
  const usage = (json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return { ...empty, error: "usage API response missing usage object" };
  }

  const toWindow = (w: unknown): GoUsageWindow | null => {
    if (!w || typeof w !== "object") return null;
    const rec = w as Record<string, unknown>;
    const percent = typeof rec.percent === "number" ? rec.percent : Number.NaN;
    const resetsAt = typeof rec.resetsAt === "string" ? rec.resetsAt : "";
    if (!Number.isFinite(percent)) return null;
    const resetInSec = resetsAt
      ? Math.max(0, Math.round((Date.parse(resetsAt) - Date.now()) / 1000))
      : 0;
    return { usagePercent: Math.round(percent), resetInSec };
  };

  const u = usage as Record<string, unknown>;
  const rolling = toWindow(u.rolling);
  const weekly = toWindow(u.weekly);
  const monthly = toWindow(u.monthly);
  if (!rolling && !weekly && !monthly) {
    return { ...empty, error: "usage API response missing usage windows" };
  }
  return { rolling, weekly, monthly, fetchedAt: Date.now() };
}

export async function fetchUsageApi(apiKey: string): Promise<GoUsageData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const resp = await fetch(USAGE_API_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (resp.status === 401) throw new Error("usage API: auth failed (401) — key invalid or expired");
    if (resp.status === 403) throw new Error("usage API: not entitled (403) — no Go plan on this key");
    if (!resp.ok) throw new Error(`usage API: HTTP ${resp.status} ${resp.statusText}`);
    return parseUsageApi(await resp.json());
  } finally {
    clearTimeout(timer);
  }
}

// ─── Billing (Zen pay-as-you-go) ─────────────────────────────────────────────

/**
 * Zen pay-as-you-go billing data, scraped from the workspace /billing page.
 *
 * `balance` and `monthlyUsage` are stored server-side in 1e-8 USD
 * ("microcents"): e.g. balance 1999960750 = $19.99960750, which the
 * dashboard renders as $20.00. `monthlyLimit`, `reloadAmount`, and
 * `reloadTrigger` are stored in whole USD dollars.
 */
export interface ZenBillingData {
  balanceUsd: number;
  monthlyUsageUsd: number;
  monthlyLimitUsd: number;
  autoReload: boolean;
  reloadAmountUsd: number;
  reloadTriggerUsd: number;
  error?: string;
  stale?: boolean;
  warning?: string;
  fetchedAt?: number;
}

const BILLING_URL = (workspaceId: string) =>
  `https://opencode.ai/workspace/${workspaceId}/billing`;
const BILLING_CACHE_FILE = path.join(
  os.tmpdir(),
  "pi",
  "pi-go-bars-billing-cache.json",
);

/** Server-side value is in 1e-8 USD. */
const MICROCENTS = 1e8;

/** SolidJS minified booleans: !0 = true, !1 = false. Also tolerate raw forms. */
function parseSolidBool(raw: string): boolean {
  if (raw === "!0" || raw === "true") return true;
  if (raw === "!1" || raw === "false" || raw === "null") return false;
  const n = Number(raw);
  return Number.isFinite(n) ? n !== 0 : false;
}

const RE_BILLING_BALANCE = /balance:(-?\d+(?:\.\d+)?)/;
const RE_BILLING_MONTHLY_USAGE = /monthlyUsage:(-?\d+(?:\.\d+)?)/;
const RE_BILLING_MONTHLY_LIMIT = /monthlyLimit:(-?\d+(?:\.\d+)?)/;
const RE_BILLING_RELOAD = /reload:(!0|!1|true|false|null)/;
const RE_BILLING_RELOAD_AMOUNT = /reloadAmount:(-?\d+(?:\.\d+)?)/;
const RE_BILLING_RELOAD_TRIGGER = /reloadTrigger:(-?\d+(?:\.\d+)?)/;

function numOrNil(html: string, re: RegExp): number | null {
  const m = re.exec(html);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Detect the billing dashboard SSR payload (guards against silent parser rot). */
function looksLikeBilling(html: string): boolean {
  return (
    html.includes("monthlyLimit") ||
    html.includes("monthlyUsage") ||
    /balance:-?\d/.test(html)
  );
}

/**
 * Extract the billing settings object from the SSR hydration output.
 *
 * The object is a SolidJS assignment whose body starts with
 * `customerID:"cus_..."` and runs to its matching closing brace. Anchoring
 * on `customerID:"cus_..."` binds all field regexes to THIS object, so a
 * future component rendered on /billing that also exposes a `balance:` or
 * `monthlyLimit:` field can't be silently matched instead.
 *
 * The object body contains no nested `{` / `}` (date values use
 * `new Date("...")`, which is parenthesised, not braced), so a flat depth
 * scan to the matching `}` is safe.
 */
function extractBillingObject(html: string): string | null {
  const start = html.indexOf('customerID:"cus_');
  if (start === -1) return null;
  const braceStart = html.lastIndexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  return null;
}

export function parseBilling(html: string): ZenBillingData {
  const obj = extractBillingObject(html);

  const empty: ZenBillingData = {
    balanceUsd: 0,
    monthlyUsageUsd: 0,
    monthlyLimitUsd: 0,
    autoReload: false,
    reloadAmountUsd: 0,
    reloadTriggerUsd: 0,
    fetchedAt: Date.now(),
  };

  // No billing object at all: either a login/redirect page, or the SSR shape
  // changed. `looksLikeBilling` disambiguates the two for the error message.
  if (!obj) {
    return looksLikeBilling(html)
      ? { ...empty, error: "billing parser may be outdated — update pi-go-bars" }
      : { ...empty, error: "no billing data on page" };
  }

  const balance = numOrNil(obj, RE_BILLING_BALANCE);
  const monthlyUsage = numOrNil(obj, RE_BILLING_MONTHLY_USAGE);
  const monthlyLimit = numOrNil(obj, RE_BILLING_MONTHLY_LIMIT);
  const reloadRaw = RE_BILLING_RELOAD.exec(obj)?.[1] ?? null;
  const reloadAmount = numOrNil(obj, RE_BILLING_RELOAD_AMOUNT);
  const reloadTrigger = numOrNil(obj, RE_BILLING_RELOAD_TRIGGER);

  // Field order may vary; if we found the object but none of the key fields,
  // treat it as parser rot rather than returning a misleading $0.00.
  if (balance === null && monthlyUsage === null && monthlyLimit === null) {
    return { ...empty, error: "billing parser may be outdated — update pi-go-bars" };
  }

  return {
    // balance & monthlyUsage are stored in 1e-8 USD (microcents)
    balanceUsd: balance !== null ? balance / MICROCENTS : 0,
    monthlyUsageUsd: monthlyUsage !== null ? monthlyUsage / MICROCENTS : 0,
    // monthlyLimit / reloadAmount / reloadTrigger are already in whole USD
    monthlyLimitUsd: monthlyLimit ?? 0,
    autoReload: reloadRaw !== null ? parseSolidBool(reloadRaw) : false,
    reloadAmountUsd: reloadAmount ?? 0,
    reloadTriggerUsd: reloadTrigger ?? 0,
    fetchedAt: Date.now(),
  };
}

export async function fetchBilling(config: GoBarsConfig): Promise<ZenBillingData> {
  const url = BILLING_URL(config.workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: {
        Cookie: `auth=${config.authCookie}`,
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const finalUrl = resp.url;
    if (!finalUrl.includes(`/workspace/${config.workspaceId}/billing`)) {
      throw new Error("Session expired or auth invalid — refresh your cookie");
    }

    const html = await resp.text();
    return parseBilling(html);
  } finally {
    clearTimeout(timer);
  }
}

interface BillingCacheEntry {
  data: ZenBillingData;
  ts: number;
}

const BILLING_CACHE_CONTEXT = "billingCache";
function readBillingCache(): BillingCacheEntry | null {
  return readCacheFile<ZenBillingData>(BILLING_CACHE_FILE, BILLING_CACHE_CONTEXT);
}
function writeBillingCache(data: ZenBillingData): void {
  writeCacheFile(BILLING_CACHE_FILE, data, BILLING_CACHE_CONTEXT);
}

/**
 * Orchestrated billing fetch: config → validation → cache → fetch → persist.
 * Returns null when there is no config, when config is invalid, OR when Zen
 * billing display is not opted in (cfg.showZen) — so the default Go-only
 * install never makes a /billing request and never renders the segment.
 * Fetch/parse errors come back as a ZenBillingData with `.error`.
 */
export async function fetchBillingWithCache(): Promise<ZenBillingData | null> {
  const cfg = loadConfig();
  if (!cfg) return null;
  if (!cfg.showZen) return null;

  const validationError = validateConfig(cfg);
  if (validationError) return null;

  const cached = readBillingCache();
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const data = await fetchBilling(cfg);
    writeBillingCache(data);
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stale = readBillingCache();
    if (stale) {
      return { ...stale.data, stale: true, warning: `stale billing (${msg})` };
    }
    return {
      balanceUsd: 0,
      monthlyUsageUsd: 0,
      monthlyLimitUsd: 0,
      autoReload: false,
      reloadAmountUsd: 0,
      reloadTriggerUsd: 0,
      error: msg,
    };
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateConfig(config: GoBarsConfig): string | null {
  if (config.apiKey) return null;
  if (!/^wrk_[A-Za-z0-9]+$/.test(config.workspaceId)) {
    return `Invalid workspaceId format: expected "wrk_...", got "${config.workspaceId}"`;
  }
  if (!config.authCookie.startsWith("Fe26.2**")) {
    return `Invalid authCookie format: expected "Fe26.2**...", got "${config.authCookie.slice(0, 10)}..."`;
  }
  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/** Orchestrated: config → validation → cache → fetch → persist */
export async function fetchWithCache(): Promise<GoUsageData> {
  const cfg = loadConfig();
  if (!cfg) {
    return {
      rolling: null,
      weekly: null,
      monthly: null,
      error: "No config — create a .env file or run /gobars-setup",
    };
  }

  // Validate config
  const validationError = validateConfig(cfg);
  if (validationError) {
    return {
      rolling: null,
      weekly: null,
      monthly: null,
      error: validationError,
    };
  }

  // Check cache
  const cached = readCache();
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // Dual-mode: official API primary, legacy /go scrape fallback.
    const apiKey = cfg.apiKey ?? discoverOpencodeKey();
    if (apiKey) {
      try {
        const data = await fetchUsageApi(apiKey);
        writeCache(data);
        return data;
      } catch (apiErr: unknown) {
        const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        // 401/403 are hard auth failures — no point falling back to the
        // cookie scrape; surface the API error. Network/parse failures fall
        // through to the legacy path.
        if (/401|403/.test(apiMsg)) {
          return { rolling: null, weekly: null, monthly: null, error: apiMsg };
        }
        logError("usage:apiFallback", apiErr);
      }
    }
    if (!cfg.workspaceId || !cfg.authCookie) {
      return {
        rolling: null,
        weekly: null,
        monthly: null,
        error: "usage API unavailable and no legacy workspace credentials configured",
      };
    }
    const data = await fetchUsage(cfg);
    writeCache(data);
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Serve stale cache with warning
    const stale = readCache();
    if (stale) {
      return { ...stale.data, stale: true, warning: `stale data (${msg})` };
    }
    return { rolling: null, weekly: null, monthly: null, error: msg };
  }
}

// ─── Formatting / rendering helpers ──────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function colorForPercent(value: number): "success" | "warning" | "error" {
  if (value >= 90) return "error";
  if (value >= 70) return "warning";
  return "success";
}

export function renderBar(theme: any, value: number, width = 8): string {
  const v = clampPercent(value);
  const filled = Math.round((v / 100) * width);
  const full = "█".repeat(Math.max(0, Math.min(width, filled)));
  const empty = "░".repeat(Math.max(0, width - filled));
  return theme.fg(colorForPercent(v), full) + theme.fg("dim", empty);
}

export function renderPercent(theme: any, value: number): string {
  const v = clampPercent(value);
  return theme.fg(colorForPercent(v), `${v}%`);
}

/** Format a USD amount with 2 decimal places, e.g. formatUsd(19.9996) === "$20.00". */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}
