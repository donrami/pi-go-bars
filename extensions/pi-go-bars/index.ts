/**
 * Pi Go Bars — pi Extension
 *
 * Shows rolling, weekly, and monthly usage for the Opencode Go plan
 * as a centred widget line between the editor and the footer, using
 * ctx.ui.setWidget() with placement "belowEditor".  Bars scale
 * dynamically to terminal width.
 *
 * Config: OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE env vars,
 * or ~/.pi/agent/pi-go-bars.json
 */

import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  Container,
  Text,
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

/**
 * Convert a foreground ANSI escape code to its background equivalent.
 * Handles 256-color (\x1b[38;5;Nm), truecolor (\x1b[38;2;R;G;Bm),
 * and falls back to simple [38→[48 replacement for basic 16-color codes.
 */
function fgToBgAnsi(fgAnsi: string): string {
  // Handle 256-color: \x1b[38;5;Nm  →  \x1b[48;5;Nm
  const m256 = fgAnsi.match(/\x1b\[38;5;(\d+)m/);
  if (m256) return `\x1b[48;5;${m256[1]}m`;

  // Handle truecolor: \x1b[38;2;R;G;Bm  →  \x1b[48;2;R;G;Bm
  const mTrue = fgAnsi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (mTrue) return `\x1b[48;2;${mTrue[1]};${mTrue[2]};${mTrue[3]}m`;

  // Fallback: simple 16-color replacement
  return fgAnsi.replace("[38", "[48");
}

const POLL_INTERVAL_MS = 30 * 1000;
const STATUS_KEY = "pi-go-bars";

/** Returns true only when the active model uses the opencode-go provider. */
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

  // ─── Widget Rendering ─────────────────────────────────────────────────────

  let uiCtx: any = null;
  let uiTheme: any = null;

  // ─── Pure layout helpers ───────────────────────────────────────────────────

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

    // Try with resets
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

  /** Responsive widget — bar widths are recalculated on every render() call
   *  so they scale with terminal width instead of overflowing. */
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

  function renderWidget() {
    if (!uiCtx || !uiTheme) return;
    uiCtx.setWidget(STATUS_KEY, () => new UsageWidget(state, uiTheme), { placement: "belowEditor" });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:session_start", err); return; }
    if (!isGoModel(_ctx.model)) return;
    renderWidget();
    await poll();
    renderWidget();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { void poll().then(() => renderWidget()); }, POLL_INTERVAL_MS);
  });

  pi.on("turn_start", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:turn_start", err); return; }
    if (!isGoModel(_ctx.model)) return;
    renderWidget();
  });

  pi.on("model_select", async (_event, _ctx) => {
    try { uiCtx = _ctx.ui; uiTheme = _ctx.ui.theme; } catch (err) { logError("lifecycle:model_select", err); return; }
    if (!isGoModel(_event.model)) {
      // Hide widget when switching away from Go models.
      try { uiCtx?.setWidget(STATUS_KEY, undefined); } catch (e) { logError("lifecycle:model_select:clear", e); }
      return;
    }
    if (!state.data || state.loading) await poll();
    renderWidget();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    try { uiCtx?.setWidget(STATUS_KEY, undefined); } catch (err) { logError("lifecycle:session_shutdown", err); }
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
      renderWidget();
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

// ─── Detail UI Component ─────────────────────────────────────────────────

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
