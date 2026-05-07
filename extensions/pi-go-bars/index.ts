/**
 * Pi Go Bars — pi Extension
 *
 * Shows rolling, weekly, and monthly usage for the Opencode Go plan
 * centred in the footer between token stats and model info, via
 * ctx.ui.setFooter().  Bars scale dynamically to terminal width.
 *
 * Config: OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE env vars,
 * or ~/.pi/agent/pi-go-bars.json
 */

import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  Container,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@mariozechner/pi-tui";
import {
  clampPercent,
  fetchWithCache,
  formatDuration,
  logError,
  renderBar,
  renderPercent,
  type GoUsageData,
} from "./core";
import { renderSetupGuide } from "./setup";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

function fgToBgAnsi(fgAnsi: string): string {
  const m256 = fgAnsi.match(/\x1b\[38;5;(\d+)m/);
  if (m256) return `\x1b[48;5;${m256[1]}m`;
  const mTrue = fgAnsi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (mTrue) return `\x1b[48;2;${mTrue[1]};${mTrue[2]};${mTrue[3]}m`;
  return fgAnsi.replace("[38", "[48");
}

const POLL_INTERVAL_MS = 30 * 1000;
const STATUS_KEY = "pi-go-bars";

function isGoModel(model: { provider: string } | undefined | null): boolean {
  return model?.provider === "opencode-go";
}

interface UsageState {
  data: GoUsageData | null;
  loading: boolean;
}

export default function (pi: ExtensionAPI) {
  const state: UsageState = { data: null, loading: true };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight: Promise<void> | null = null;
  let pollQueued = false;

  // ─── Polling ───────────────────────────────────────────────────────────────

  async function runPoll() {
    state.data = await fetchWithCache();
  }

  async function poll() {
    if (pollInFlight) { pollQueued = true; await pollInFlight; return; }
    do {
      pollQueued = false;
      pollInFlight = runPoll()
        .catch((err) => { logError("poll:runPoll", err); })
        .finally(() => { pollInFlight = null; state.loading = false; });
      await pollInFlight;
    } while (pollQueued);
  }

  // ─── Footer state ──────────────────────────────────────────────────────────

  let uiCtx: any = null;
  let uiTheme: any = null;
  let tuiRef: any = null;
  let thinkingLevel = "off";
  let footerActive = false;

  function formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
  }

  function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
  }

  // ─── Pure layout helpers (used by footer bars and detail view) ─────────────

  interface Win {
    label: string;
    pct: number;
    resetSec: number;
  }

  interface Layout {
    showLabels: boolean;
    showResets: boolean;
    barSlots: number;
  }

  function calculateLayout(width: number, wins: Win[], staleWidth: number): Layout {
    const MIN_BAR = 3;
    const MAX_BAR = 20;

    let fixed = "Go".length;
    let showLabels = true;
    let showResets = true;
    for (const w of wins) {
      fixed += 1 + w.label.length + 1;
      if (w.resetSec > 0) fixed += 3 + visibleWidth(formatDuration(w.resetSec));
    }
    fixed += staleWidth;

    let barSlots = wins.length > 0
      ? Math.min(MAX_BAR, Math.floor((width - fixed) / wins.length))
      : 0;

    if (barSlots < 5) {
      showResets = false;
      fixed = "Go".length;
      for (const w of wins) fixed += 1 + w.label.length + 1;
      fixed += staleWidth;
      barSlots = wins.length > 0
        ? Math.min(MAX_BAR, Math.floor((width - fixed) / wins.length))
        : 0;
    }

    if (barSlots < MIN_BAR) {
      showLabels = false;
      fixed = "Go".length;
      fixed += staleWidth;
      barSlots = wins.length > 0
        ? Math.min(MAX_BAR, Math.floor((width - fixed) / wins.length))
        : 0;
    }

    barSlots = Math.max(MIN_BAR, barSlots);
    return { showLabels, showResets, barSlots };
  }

  function renderBarSegment(t: any, w: Win, barSlots: number): string {
    const barCol = "muted";
    const barBg = fgToBgAnsi(t.getFgAnsi(barCol));
    const v = clampPercent(w.pct);
    const label = v + "%";
    const lw = label.length;
    const bw = barSlots;

    if (v === 0) {
      return t.fg(barCol, label) + t.fg("dim", "\u2591".repeat(Math.max(0, bw - lw)));
    }

    const filled = Math.max(1, Math.round((v / 100) * bw));
    const before = Math.max(0, Math.min(filled, Math.floor((filled - lw) / 2)));
    const after = Math.max(0, filled - before - lw);
    const empty = Math.max(0, bw - before - lw - after);
    return (
      t.fg(barCol, "\u2588".repeat(before)) +
      barBg + t.bold(label) + "\x1b[39m\x1b[49m" +
      t.fg(barCol, "\u2588".repeat(after)) +
      t.fg("dim", "\u2591".repeat(empty))
    );
  }

  // ─── Footer bar renderer ───────────────────────────────────────────────────

  /** Build a compact bar string that fits within maxWidth (returns "" if too narrow). */
  function renderFooterBars(t: any, data: GoUsageData | null, loading: boolean, maxWidth: number): string {
    if (loading) {
      return visibleWidth(t.fg("dim", "Go loading...")) <= maxWidth
        ? t.fg("dim", "Go loading...") : "";
    }
    if (!data || data.error) return "";

    const staleSuffix = data.stale ? t.fg("warning", " stale") : "";
    const elapsed = data.fetchedAt ? Math.floor((Date.now() - data.fetchedAt) / 1000) : 0;

    const wins: Win[] = [];
    if (data.rolling) wins.push({ label: "R", pct: data.rolling.usagePercent, resetSec: Math.max(0, data.rolling.resetInSec - elapsed) });
    if (data.weekly) wins.push({ label: "W", pct: data.weekly.usagePercent, resetSec: Math.max(0, data.weekly.resetInSec - elapsed) });
    if (data.monthly) wins.push({ label: "M", pct: data.monthly.usagePercent, resetSec: Math.max(0, data.monthly.resetInSec - elapsed) });

    if (wins.length === 0) return "";

    const staleW = visibleWidth(staleSuffix);

    // Determine minimum viable layout
    let barSlots = 4;
    let showLabels = false;
    let showResets = false;

    const bareWidth = visibleWidth("Go") + wins.length * (1 + 4) + staleW; // "Go" + " " + 4-char bar per window
    if (bareWidth > maxWidth) return "";

    // Try labels + resets, then labels only, then bare
    const withLabelsResets = visibleWidth("Go") +
      wins.reduce((s, w) => s + 1 + w.label.length + 1 + 4 + (w.resetSec > 0 ? 3 + visibleWidth(formatDuration(w.resetSec)) : 0), 0) + staleW;
    const withLabels = visibleWidth("Go") +
      wins.reduce((s, w) => s + 1 + w.label.length + 1 + 4, 0) + staleW;

    if (withLabelsResets <= maxWidth) { showLabels = true; showResets = true; barSlots = 4; }
    else if (withLabels <= maxWidth) { showLabels = true; barSlots = 4; }
    else { barSlots = 4; }

    // Expand bars to fill remaining space
    let used = visibleWidth("Go");
    for (const w of wins) {
      used += showLabels ? 1 + w.label.length + 1 : 1;
      used += barSlots;
      if (showResets && w.resetSec > 0) used += 3 + visibleWidth(formatDuration(w.resetSec));
    }
    used += staleW;
    const remaining = Math.max(0, maxWidth - used);
    const extraPerBar = wins.length > 0 ? Math.floor(remaining / wins.length) : 0;
    barSlots = Math.min(20, barSlots + extraPerBar);

    const parts: string[] = [t.fg("dim", "Go")];
    for (const w of wins) {
      if (showLabels) parts.push(t.fg("muted", " " + w.label + " "));
      else parts.push(" ");
      parts.push(renderBarSegment(t, w, barSlots));
      if (showResets && w.resetSec > 0)
        parts.push(t.fg("dim", " \u27F3 " + formatDuration(w.resetSec)));
    }
    return parts.join("") + staleSuffix;
  }

  // ─── Footer setup ──────────────────────────────────────────────────────────

  function setupFooter(ctx: any) {
    if (!ctx.ui) return;
    // Clear the old belowEditor widget so it doesn't render alongside the footer.
    try { ctx.ui.setWidget(STATUS_KEY, undefined); } catch { /* ignore */ }
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      tuiRef = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // ── Line 1: cwd ──────────────────────────────────────────────────
          let pwd = ctx.sessionManager.getCwd();
          const home = process.env.HOME || process.env.USERPROFILE;
          if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
          const branch = footerData.getGitBranch();
          if (branch) pwd = `${pwd} (${branch})`;
          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) pwd = `${pwd} • ${sessionName}`;
          const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

          // ── Line 2: stats + bars + model ─────────────────────────────────
          let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0;
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              totalInput += entry.message.usage.input;
              totalOutput += entry.message.usage.output;
              totalCacheRead += entry.message.usage.cacheRead;
              totalCacheWrite += entry.message.usage.cacheWrite;
              totalCost += entry.message.usage.cost.total;
            }
          }

          const contextUsage = ctx.getContextUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

          const statsParts: string[] = [];
          if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
          if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
          if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
          let usingSubscription = false;
          try { usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false; } catch { /* ignore */ }
          if (totalCost || usingSubscription) {
            statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
          }

          let contextPercentStr: string;
          const contextPercentDisplay = contextPercent === "?"
            ? `?/${formatTokens(contextWindow)}`
            : `${contextPercent}%/${formatTokens(contextWindow)}`;
          if (contextPercentValue > 90) contextPercentStr = theme.fg("error", contextPercentDisplay);
          else if (contextPercentValue > 70) contextPercentStr = theme.fg("warning", contextPercentDisplay);
          else contextPercentStr = contextPercentDisplay;
          statsParts.push(contextPercentStr);
          const statsLeft = statsParts.join(" ");

          // Model right
          const model = ctx.model;
          let rightSide = model?.id || "no-model";
          if (model?.reasoning) {
            const level = thinkingLevel || "off";
            rightSide = level === "off" ? `${rightSide} • thinking off` : `${rightSide} • ${level}`;
          }
          if (footerData.getAvailableProviderCount() > 1 && model) {
            const withProvider = `(${model.provider}) ${rightSide}`;
            if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
              rightSide = withProvider;
            }
          }

          // Bars
          const statsVisible = visibleWidth(statsLeft);
          const modelVisible = visibleWidth(rightSide);
          const minGap = 2;
          let barSpace = width - statsVisible - modelVisible - minGap * 2;
          if (barSpace < 12) barSpace = 0;
          const bars = barSpace > 0 ? renderFooterBars(theme, state.data, state.loading, barSpace) : "";
          const barsVisible = visibleWidth(stripAnsi(bars));

          let statsLine: string;
          if (barsVisible > 0) {
            const contentW = statsVisible + minGap + barsVisible + minGap + modelVisible;
            if (contentW <= width) {
              const gapLeft = Math.max(minGap, Math.floor((width - statsVisible - barsVisible - modelVisible) / 2));
              const gapRight = width - statsVisible - barsVisible - modelVisible - gapLeft;
              statsLine = statsLeft + " ".repeat(gapLeft) + bars + " ".repeat(gapRight) + rightSide;
            } else {
              const pad = " ".repeat(Math.max(minGap, width - statsVisible - modelVisible));
              statsLine = statsLeft + pad + rightSide;
            }
          } else {
            const pad = " ".repeat(Math.max(minGap, width - statsVisible - modelVisible));
            statsLine = statsLeft + pad + rightSide;
          }

          const dimStatsLeft = theme.fg("dim", statsLeft);
          const remainder = statsLine.slice(statsLeft.length);
          const statsLineStyled = dimStatsLeft + theme.fg("dim", remainder);
          const lines = [pwdLine, statsLineStyled];

          // Extension statuses
          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .sort(([a]: any, [b]: any) => String(a).localeCompare(String(b)))
              .map(([, text]: any) => String(text).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
            lines.push(truncateToWidth(sortedStatuses.join(" "), width, theme.fg("dim", "...")));
          }
          return lines;
        },
      };
    });
    footerActive = true;
  }

  function clearFooter(ctx: any) {
    try { ctx?.ui?.setFooter(undefined); } catch (err) { logError("footer:clear", err); }
    // Also clear the old widget to prevent orphaned bars on non-Go model switch.
    try { ctx?.ui?.setWidget(STATUS_KEY, undefined); } catch { /* ignore */ }
    footerActive = false;
    tuiRef = null;
  }

  // ─── UsageWidget (for /gobars detail view) ─────────────────────────────────

  class UsageWidget implements Component {
    private s: UsageState;
    private t: any;

    constructor(s: UsageState, t: any) { this.s = s; this.t = t; }
    invalidate() {}

    render(width: number): string[] {
      const { data } = this.s;
      const t = this.t;

      if (this.s.loading) return this.ctr(t.fg("dim", "Go  loading..."), width);
      if (!data) return [""];
      if (data.error) return this.ctr(t.fg("warning", "Go  " + data.error), width);

      const staleSuffix = data.stale ? t.fg("warning", " stale") : "";
      const elapsed = data.fetchedAt ? Math.floor((Date.now() - data.fetchedAt) / 1000) : 0;

      const wins: Win[] = [];
      if (data.rolling) wins.push({ label: "R", pct: data.rolling.usagePercent, resetSec: Math.max(0, data.rolling.resetInSec - elapsed) });
      if (data.weekly) wins.push({ label: "W", pct: data.weekly.usagePercent, resetSec: Math.max(0, data.weekly.resetInSec - elapsed) });
      if (data.monthly) wins.push({ label: "M", pct: data.monthly.usagePercent, resetSec: Math.max(0, data.monthly.resetInSec - elapsed) });

      const layout = calculateLayout(width, wins, visibleWidth(staleSuffix));
      const parts: string[] = [t.fg("dim", "Go")];

      for (const w of wins) {
        if (layout.showLabels) parts.push(t.fg("muted", " " + w.label + " "));
        parts.push(renderBarSegment(t, w, layout.barSlots));
        if (layout.showResets && w.resetSec > 0)
          parts.push(t.fg("dim", " \u27F3 " + formatDuration(w.resetSec)));
      }

      return this.ctr(parts.join("") + staleSuffix, width);
    }

    private ctr(text: string, w: number): string[] {
      const tw = visibleWidth(text);
      if (tw >= w) return [text];
      return [" ".repeat(Math.floor((w - tw) / 2)) + text];
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:session_start", err); return; }
    if (!isGoModel(_ctx.model)) return;
    setupFooter(_ctx);
    await poll();
    tuiRef?.requestRender();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { void poll().then(() => tuiRef?.requestRender()); }, POLL_INTERVAL_MS);
  });

  pi.on("turn_start", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:turn_start", err); return; }
    if (!isGoModel(_ctx.model)) return;
  });

  pi.on("model_select", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:model_select", err); return; }
    if (!isGoModel(_event.model)) {
      clearFooter(_ctx);
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      return;
    }
    if (!footerActive) {
      setupFooter(_ctx);
      if (!state.data || state.loading) await poll();
      tuiRef?.requestRender();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => { void poll().then(() => tuiRef?.requestRender()); }, POLL_INTERVAL_MS);
    }
  });

  pi.on("thinking_level_select", async (_event, _ctx) => {
    thinkingLevel = _event.level;
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    clearFooter(_ctx);
    // Belt-and-suspenders: ensure widget is also gone.
    try { _ctx?.ui?.setWidget(STATUS_KEY, undefined); } catch { /* ignore */ }
  });

  // ─── Commands ──────────────────────────────────────────────────────────────

  pi.registerCommand("gobars", {
    description: "Show Opencode Go plan usage (rolling / weekly / monthly)",
    handler: async (_args, _ctx) => {
      try {
        if (_ctx.ui) {
          await _ctx.ui.custom<void>((tui, theme, _kb, done) =>
            buildUsageDetail(theme, state.data, done),
          );
        }
      } catch (err) { logError("command:gobars", err); }
      await poll();
      tuiRef?.requestRender();
    },
  });

  pi.registerCommand("gobars-setup", {
    description: "Configure Go usage bars (workspace ID + auth cookie)",
    handler: async (_args, _ctx) => {
      try {
        if (_ctx.ui) {
          await _ctx.ui.custom<void>((tui, theme, _kb, done) =>
            renderSetupGuide(tui, theme, done),
          );
        }
      } catch (err) { logError("command:gobars-setup", err); }
    },
  });
}

// ─── Detail UI Component ─────────────────────────────────────────────────────

function buildUsageDetail(theme: any, data: GoUsageData | null, done: () => void): Container & Focusable {
  const t = theme;
  const comp = new Container() as Container & Focusable;
  (comp as any)._focused = true;
  comp.handleInput = () => { done(); };

  const lines: string[] = [];
  lines.push(t.bold("OpenCode Go \u2014 Usage"));
  lines.push("");

  if (!data) {
    lines.push(t.fg("dim", "Loading\u2026"));
  } else if (data.error) {
    lines.push(t.fg("error", data.error));
  } else {
    if (data.stale && data.warning) {
      lines.push(t.fg("warning", "\u26A0 " + data.warning));
      lines.push("");
    }

    const renderWin = (label: string, w: { usagePercent: number; resetInSec: number } | null) => {
      if (!w) return;
      const pct = clampPercent(w.usagePercent);
      const reset = w.resetInSec > 0 ? t.fg("dim", "  resets in " + formatDuration(w.resetInSec)) : "";
      lines.push(
        t.fg("muted", label.padEnd(8)) +
        renderBar(t, pct, 16) +
        " " +
        renderPercent(t, pct) +
        reset,
      );
      lines.push("");
    };

    renderWin("Rolling", data.rolling);
    renderWin("Weekly", data.weekly);
    renderWin("Monthly", data.monthly);
  }

  lines.push(t.fg("dim", "Press any key to close"));

  for (const line of lines) {
    comp.addChild(new Text(line, 0, 0));
  }

  return comp;
}
