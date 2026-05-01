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
}

function isString(val: unknown): val is string {
  return typeof val === "string";
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
      }
    }

    if (workspaceId && authCookie) {
      return { workspaceId, authCookie } as GoBarsConfig;
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
  // 1) Environment variables (most secure)
  const envWs = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const envCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (envWs && envCookie) {
    return { workspaceId: envWs, authCookie: envCookie } as GoBarsConfig;
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
    if (ws && cookie) return { workspaceId: ws, authCookie: cookie } as GoBarsConfig;
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

interface CacheEntry {
  data: GoUsageData;
  ts: number;
}

function readCache(): CacheEntry | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry?.data && typeof entry.ts === "number") return entry;
  } catch (err) {
    logError("cache:read", err);
  }
  return null;
}

function writeCache(data: GoUsageData): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${CACHE_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ data, ts: Date.now() }));
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    logError("cache:write", err);
  }
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

const DASHBOARD_URL = (workspaceId: string) =>
  `https://opencode.ai/workspace/${workspaceId}/go`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
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

// ─── Validation ──────────────────────────────────────────────────────────────

function validateConfig(config: GoBarsConfig): string | null {
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
