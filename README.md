# pi-go-bars

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="package.json"><img alt="Node: >=18" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen"></a>
  <a href="https://github.com/donrami/pi-go-bars"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/donrami/pi-go-bars"></a>
  <a href="https://pi.dev"><img alt="pi extension" src="https://img.shields.io/badge/pi-extension-purple"></a>
</p>

[pi](https://pi.dev) extension that shows Opencode Go plan usage (rolling / weekly / monthly windows) as a **centred widget line** between the editor and the footer, with percentage values embedded inside colour-coded bars.

![Go usage bars widget screenshot](screenshot.png)

## Install

```bash
pi install npm:pi-go-bars
```

Or install locally from source:

```bash
pi install path:/path/to/pi-go-bars
```

## Quick Start

### Option 1: Environment Variables (Recommended)

Most secure — credentials never touch disk.

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_YOUR_WORKSPACE_ID"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**YOUR_AUTH_COOKIE"
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`) and run `source ~/.bashrc` (or `~/.zshrc`). Restart pi.

### Option 2: JSON Config File

Easiest setup — credentials stored on disk with restricted permissions.

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

### Interactive Setup

Run the setup guide from within pi:

```
/gobars-setup
```

It will walk you through finding your credentials and choosing a config method.

## Getting Your Credentials

### Workspace ID

1. Open [https://opencode.ai](https://opencode.ai) in your browser
2. Navigate to your Go workspace
3. Copy the ID from the URL:

```
https://opencode.ai/workspace/wrk_XXXXXXXXXXXXXXXX/go
                              ^^^^^^^^^^^^^^^^^^^^
                              This is your workspace ID
```

### Auth Cookie

1. Open browser Dev Tools (**F12**)
2. Go to **Application** → **Storage** → **Cookies** → `opencode.ai`
3. Find the cookie named `auth`
4. Copy its value (starts with `Fe26.2**`)


## Usage

### Widget Line

When configured, a centred widget line appears between the editor and the footer:

```
         Go  R ██████42%██████  W ██████17%██████  M ████8%██████████
```

The widget bars use the theme's **"muted"** colour — no green/yellow/red
percentage coding. The percentage text is embedded inside the bar as a visual
"cutout" with bold text on the muted background.

Bar widths are **dynamic**: they scale to the terminal width (max 20 chars per
bar, min 3). On narrow terminals, the display **degrades gracefully**: reset
countdowns are dropped when bars would shrink below 5 chars, and window labels
are dropped when bars would shrink below 3 chars. Nothing overflows or wraps.

At **0%** no bar segment is drawn; the text appears in muted on dim. At **>0%**
at least one filled segment is forced so the cutout has room. Reset countdowns
(`⟳ 4h`) tick down live on every render.

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
| `/gobars-setup` | Interactive guide for configuring credentials |

## Troubleshooting

### "No config" error

The extension can't find your workspace ID or auth cookie. Run `/gobars-setup` or check that your env variables are set:

```bash
echo $OPENCODE_GO_WORKSPACE_ID
echo $OPENCODE_GO_AUTH_COOKIE
```

### "HTTP 401" or "HTTP 403" error

Your auth cookie has expired. Get a fresh cookie from browser Dev Tools and update your config.

### "stale data" warning

The live fetch failed but cached data is available. Common causes: network issues, expired cookie. The cached data will be shown with a stale badge until the fetch succeeds again.

### "parser may be outdated" error

Opencode may have changed their dashboard HTML structure. Update this package:

```bash
pi install npm:pi-go-bars  # reinstall latest version
```

If the problem persists, [open an issue](https://github.com/donrami/pi-go-bars/issues).

### Widget line doesn't appear

1. Make sure the extension is installed: `pi list`
2. Run `/gobars` to manually trigger a fetch and render
3. If using print mode (`-p`) or RPC mode, widgets aren't rendered — use interactive mode
4. Check pi's logs for extension errors

## How It Works

**Display:** Uses `ctx.ui.setWidget()` with `placement: "belowEditor"` to render
a dedicated line between the editor and the footer. This avoids overflow issues
that occur when using `ctx.ui.setStatus()` with custom single-line footers like
powerline-footer.

**Bar rendering:** A `UsageWidget` component recalculates bar widths on every
render from the current terminal width (max 20 chars per bar, min 3). Bars use
the theme's **"muted"** colour — no green/yellow/red coding. The percentage text
is embedded inside the bar with bold text on the muted background. At 0% no bar
segment is drawn; at >0% at least one filled `█` is forced so the cutout has
room.

**Graceful degradation:** On narrow terminals, reset countdowns are dropped when
bars would shrink below 5 chars per window; window labels are dropped when bars
would shrink below 3 chars. Nothing overflows or wraps.

**Countdowns:** Reset times (`⟳ 4h`) are adjusted by elapsed time since
`fetchedAt` on every render, so they tick down live.

**Polling:** Fetches data every 30 seconds. A 90-second cache TTL means most
polls return cached data without a network request. The widget re-renders on
every poll tick, every `turn_start`, and every `model_select`.

**Data source:** Scrapes the Opencode Go dashboard at
`https://opencode.ai/workspace/{id}/go` and parses the SolidJS SSR hydration
output to extract `rollingUsage`, `weeklyUsage`, and `monthlyUsage` objects
containing `usagePercent` and `resetInSec`.

This approach is used until the official API endpoint (`/zen/go/v1/usage`) is
merged (see [opencode#16513](https://github.com/anomalyco/opencode/pull/16513)).

## License

MIT
