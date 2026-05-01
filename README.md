# pi-go-bars

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="package.json"><img alt="Node: >=18" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen"></a>
  <a href="https://github.com/donrami/pi-go-bars"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/donrami/pi-go-bars"></a>
  <a href="https://pi.dev"><img alt="pi extension" src="https://img.shields.io/badge/pi-extension-purple"></a>
</p>

[pi](https://pi.dev) extension that shows Opencode Go plan usage as a widget line between the editor and the footer. Rolling, weekly, and monthly windows are rendered as inline percentage bars using the terminal's muted theme colour.

![Go usage bars widget screenshot](screenshot.png)

## Install

```bash
git clone https://github.com/donrami/pi-go-bars.git
cd pi-go-bars
pi install .
```

## Quick Start

### Option 1: Environment Variables (Recommended)

Credentials stay in memory only.

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_YOUR_WORKSPACE_ID"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**YOUR_AUTH_COOKIE"
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`), run `source ~/.bashrc` (or `~/.zshrc`), and restart pi.

### Option 2: JSON Config File

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/pi-go-bars.json << 'EOF'
{
  "workspaceId": "wrk_YOUR_WORKSPACE_ID",
  "authCookie": "Fe26.2**YOUR_AUTH_COOKIE"
}
EOF
chmod 600 ~/.pi/agent/pi-go-bars.json
```

Restart pi.

### Setup Guide

Run `/gobars-setup` inside pi to display the setup instructions. This prints the same credential and config guidance found below — it does not perform any configuration or initiate an interactive flow.

### Migration from opencode-go-usage

If you previously used the `opencode-go-usage` plugin, pi-go-bars will
automatically read your existing config from:
- `~/.config/opencode/opencode-go-usage.json`
- `~/.opencode/opencode-go-usage.json`

To migrate permanently, run `/gobars-setup` and choose the persistent JSON option.

## Getting Your Credentials

### Workspace ID

1. Open [https://opencode.ai](https://opencode.ai) and navigate to your Go workspace.
2. Copy the ID from the URL:

```
https://opencode.ai/workspace/wrk_XXXXXXXXXXXXXXXX/go
                              ^^^^^^^^^^^^^^^^^^^^
```

### Auth Cookie

1. Open browser Dev Tools (**F12**).
2. Go to **Application** → **Storage** → **Cookies** → `opencode.ai`.
3. Find the cookie named `auth` and copy its value (starts with `Fe26.2**`).

## Usage

When configured, a centred widget line appears between the editor and the footer:

```
         Go  R ██████42%██████  W ██████17%██████  M ████8%██████████
```

`R`, `W`, and `M` show rolling (5-hour), weekly (7-day), and monthly (30-day) usage. Percentages render in bold inside muted-theme bars. Reset countdowns (`⟳ 4h`) tick down live on every render.

Bar widths scale with the terminal (max 20 chars, min 3). On narrow terminals the display degrades gracefully: countdowns drop when bars would shrink below 5 chars, then window labels drop below 3 chars. Nothing overflows.

At **0%** no bar segment is drawn and the text appears dim.

| Symbol | Meaning |
|---|---|
| `R` | Rolling usage (5-hour window) |
| `W` | Weekly usage (7-day window) |
| `M` | Monthly usage (30-day window) |
| `⟳` | Reset countdown |

### Commands

| Command | Description |
|---|---|
| `/gobars` | Open detail view with full-width 16-char bars for all three windows |
| `/gobars-setup` | Display setup instructions (text only, non-interactive) |

## How It Works

**Display.** The widget is rendered via `ctx.ui.setWidget()` with `placement: "belowEditor"`. This avoids the overflow issues that can occur when `ctx.ui.setStatus()` competes with custom footers.

**Bar rendering.** A `UsageWidget` component recalculates widths on every render from the current terminal dimensions. Percentage text is embedded inside the bar as a bold cutout on the muted background.

**Graceful degradation.** If the terminal is too narrow for the full display, countdowns are hidden first (bars < 5 chars), then window labels (bars < 3 chars).

**Countdowns.** Reset times are adjusted by elapsed time since `fetchedAt` on every render, so they count down live without polling.

**Polling.** Data is fetched every 30 seconds. A 90-second cache TTL means most polls return cached data without a network request. The widget re-renders on every poll tick, `turn_start`, and `model_select`.

**Data source.** The extension scrapes the Opencode Go dashboard (`https://opencode.ai/workspace/{id}/go`) and parses the SolidJS SSR hydration output to extract `rollingUsage`, `weeklyUsage`, and `monthlyUsage` objects containing `usagePercent` and `resetInSec`. This will be replaced by the official API endpoint (`/zen/go/v1/usage`) once it is available (see [opencode#16513](https://github.com/anomalyco/opencode/pull/16513)).

## Troubleshooting

### "No config" error

Run `/gobars-setup` to re-read the setup instructions, or verify your environment variables:

```bash
echo $OPENCODE_GO_WORKSPACE_ID
echo $OPENCODE_GO_AUTH_COOKIE
```

### "HTTP 401" or "HTTP 403" error

Your auth cookie is likely expired. Copy a fresh cookie from browser Dev Tools and update your config.

### "stale data" warning

The live fetch failed but cached data is available. Check your network connection and cookie freshness. The stale badge disappears once a fetch succeeds.

### "parser may be outdated" error

Opencode may have changed their dashboard HTML. Reinstall from source:

```bash
cd /path/to/pi-go-bars
git pull
pi install .
```

If the problem persists, [open an issue](https://github.com/donrami/pi-go-bars/issues).

### Widget line doesn't appear

1. Run `/gobars` to manually trigger a fetch.
2. Widgets are only rendered in interactive mode. They won't appear in print (`-p`) or RPC mode.
3. Check pi's logs for extension errors.

## Programmatic Usage

If you are building another pi extension, you can import utilities from `pi-go-bars`:

```ts
import { clampPercent, renderBar } from "pi-go-bars/extensions/pi-go-bars/core";
```

The following helpers are exported from `core.ts` for stable reuse:

| Function | Purpose |
|---|---|
| `clampPercent(value)` | Clamp to 0–100 and round |
| `colorForPercent(value)` | Returns `"success"`, `"warning"`, or `"error"` |
| `renderBar(theme, value, width?)` | Colored bar string |
| `renderPercent(theme, value)` | Colored percent string |
| `formatDuration(seconds)` | Human-readable countdown |
| `writeConfig(config, path?)` | Atomic config write with `chmod 600` |

## License

MIT
