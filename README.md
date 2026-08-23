# pi-go-bars

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://www.npmjs.com/package/pi-go-bars"><img alt="npm version" src="https://img.shields.io/npm/v/pi-go-bars"></a>
  <a href="package.json"><img alt="Node: >=22.6" src="https://img.shields.io/badge/node-%3E%3D22.6-brightgreen"></a>
  <a href="https://github.com/donrami/pi-go-bars"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/donrami/pi-go-bars"></a>
  <a href="https://pi.dev"><img alt="pi extension" src="https://img.shields.io/badge/pi-extension-purple"></a>
</p>

[pi](https://pi.dev) extension that shows your **Opencode Go plan usage** as inline bars in the footer — rolling, weekly, and monthly windows with live reset countdowns. Optionally also shows **Zen pay-as-you-go** balance and monthly spend.

- Zero config when you use opencode with a Go plan (key auto-discovered from opencode's `auth.json`)
- Official usage API (`/zen/go/v1/usage`), with the legacy dashboard scrape as automatic fallback
- Graceful degradation on narrow terminals — nothing overflows

![Go usage bars widget screenshot](screenshot.png)

## Install

```bash
git clone https://github.com/donrami/pi-go-bars.git
cd pi-go-bars
pi install .
```

## Configuration

The extension resolves credentials in this order: env vars → `.env` → `~/.pi/agent/pi-go-bars.json` → legacy `opencode-go-usage` config. An API key is preferred; the workspace cookie scrape is used only when no key is found.

### API key (preferred — usually nothing to do)

If you use opencode with the Go plan, the `opencode-go` key from opencode's own auth file is picked up automatically:

```
~/.local/share/opencode/auth.json   (Linux)
~/.config/opencode/auth.json        (fallback)
```

The entry looks like `{ "opencode-go": { "type": "api", "key": "sk-..." } }`. To override it explicitly:

```bash
export OPENCODE_GO_API_KEY="sk-..."
```

or put `"apiKey": "sk-..."` in the JSON config below.

### Option 1: Environment variables

```bash
export OPENCODE_GO_API_KEY="sk-..."              # optional; auto-discovered otherwise
# Legacy fallback (only used when no API key is found):
export OPENCODE_GO_WORKSPACE_ID="wrk_YOUR_WORKSPACE_ID"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**YOUR_AUTH_COOKIE"
# Optional: also show Zen pay-as-you-go billing (off by default)
export OPENCODE_GO_SHOW_ZEN=1
```

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`), `source` it, and restart pi.

### Option 2: JSON config file (persistent)

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/pi-go-bars.json << 'EOF'
{
  "apiKey": "sk-...",
  "workspaceId": "wrk_YOUR_WORKSPACE_ID",
  "authCookie": "Fe26.2**YOUR_AUTH_COOKIE",
  "showZen": false
}
EOF
chmod 600 ~/.pi/agent/pi-go-bars.json
```

Then restart pi. Set `"showZen": true` to enable the Zen billing segment.

### Finding the legacy credentials (cookie fallback)

Only needed when no API key is available. For the optional Zen segment, these are required even with an API key (see the Zen section above).

1. Open [https://opencode.ai](https://opencode.ai) and go to your Go workspace.
2. **Workspace ID** — copy the `wrk_...` part from the URL: `https://opencode.ai/workspace/wrk_XXXXXXXXXXXXXXXX/go`.
3. **Auth cookie** — browser Dev Tools (**F12**) → **Application** → **Storage** → **Cookies** → `opencode.ai`; copy the `auth` cookie (starts with `Fe26.2**`).

### Migrating from opencode-go-usage

pi-go-bars automatically reads an existing `opencode-go-usage` config from `~/.config/opencode/opencode-go-usage.json` or `~/.opencode/opencode-go-usage.json`. Run `/gobars-setup` inside pi for a walkthrough of the current options.

## Usage

When the active model is `opencode-go`, a centred widget line appears in the footer:

```
         Go  R ██████42%██████  W ██████17%██████  M ████8%██████████
```

`R`, `W`, and `M` are rolling (5-hour), weekly (7-day), and monthly (30-day) usage. Percentages render in bold inside muted-theme bars; reset countdowns (`⟳ 4h`) tick down live on every render. At 0% the label renders dim with an empty bar.

Bar widths scale with the terminal (max 20 chars, min 3). On narrow terminals countdowns drop first, then window labels — nothing overflows.

| Symbol | Meaning |
|---|---|
| `R` | Rolling usage (5-hour window) |
| `W` | Weekly usage (7-day window) |
| `M` | Monthly usage (30-day window) |
| `⟳` | Reset countdown |

### Zen pay-as-you-go billing (optional)

Off by default. Enable with `OPENCODE_GO_SHOW_ZEN=1` or `"showZen": true`. It scrapes the workspace `/billing` page in parallel:

> Note: the Zen balance has **no official API** — [opencode#44189](https://github.com/anomalyco/opencode/issues/44189) tracks exposing it. The segment always uses the **cookie fallback** (workspace ID + auth cookie), even when an API key is configured for Go usage. No cookie configured → no Zen segment.

```
Go R ████42%██████ W ██████17%██████ M ████8%██████████   Zen $20.00 $0.00/$50.00
```

It shows the current balance and this month's spend / monthly limit. The spend figure colours by percentage of the limit (dim at 0%, green <70%, yellow 70–90%, red ≥90%), and the segment degrades as the terminal narrows: `Zen $20.00 $0.00/$50.00` → `Zen $20.00` → `$20.00` → hidden. When disabled, no `/billing` request is made.

### Commands

| Command | Description |
|---|---|
| `/gobars` | Detail view with full-width 16-char bars for all three windows (plus the Zen section, if enabled) |
| `/gobars-setup` | Display setup instructions (text only, non-interactive) |

## How It Works

- **Display** — rendered through `ctx.ui.setFooter()`, centred between the token stats and the model name; hidden unless the active model is `opencode-go`.
- **Data source** — primary: `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` (see [opencode#16513](https://github.com/anomalyco/opencode/pull/16513)). Fallback: scrape of the Go dashboard (`https://opencode.ai/workspace/{id}/go`) when no key is configured. Both paths parse the same `rollingUsage` / `weeklyUsage` / `monthlyUsage` windows. On the API path, 401/403 surface directly (invalid or non-entitled key).
- **Zen billing** — when enabled, the `/billing` page is scraped in parallel (workspace cookie; the official usage API has no balance endpoint — [opencode#44189](https://github.com/anomalyco/opencode/issues/44189)) and parsed from its SolidJS hydration object (anchored on `customerID:"cus_..."` so a future component exposing its own `balance:` field can't false-match). `balance` and `monthlyUsage` are stored in 1e-8 USD ("microcents"), `monthlyLimit` / `reloadAmount` / `reloadTrigger` in whole USD; `parseBilling` normalises both.
- **Polling** — every 30 seconds, with a 90-second cache TTL so most polls return cached data. Re-renders on poll ticks, `turn_start`, and `model_select`. Countdowns are computed from elapsed time on each render, so they stay live without extra requests.

## Troubleshooting

### "HTTP 401" / "HTTP 403"

With an API key: the key is invalid (401) or not entitled to the Go plan (403). Check the `opencode-go` entry in `~/.local/share/opencode/auth.json`, or set `OPENCODE_GO_API_KEY`. With the legacy cookie path: the cookie is likely expired — copy a fresh one and update your config.

### "stale data" warning

The live fetch failed but cached data is available. Check your network connection and credential freshness. The badge disappears once a fetch succeeds.

### "parser may be outdated" error

Opencode changed their dashboard HTML — either the `/go` scrape or the `/billing` scrape (if enabled). Update and reinstall:

```bash
cd /path/to/pi-go-bars
git pull
pi install .
```

If it persists, [open an issue](https://github.com/donrami/pi-go-bars/issues).

### Widget line doesn't appear

1. The footer bars only render when the active model is `opencode-go` (check with `/models`).
2. Run `/gobars` to manually trigger a fetch.
3. Widgets only render in interactive mode — not in print (`-p`) or RPC mode.
4. Check pi's logs for extension errors.

## Programmatic Usage

Build another pi extension on top of the utilities exported from `core.ts`:

```ts
import { clampPercent, renderBar, parseUsageApi } from "pi-go-bars/extensions/pi-go-bars/core";
```

| Function | Purpose |
|---|---|
| `clampPercent(value)` | Clamp to 0–100 and round |
| `colorForPercent(value)` | `"success"` / `"warning"` / `"error"` for a percentage |
| `renderBar(theme, value, width?)` | Coloured bar string |
| `renderPercent(theme, value)` | Coloured percent string |
| `formatDuration(seconds)` | Human-readable countdown |
| `formatUsd(value)` | Format USD as `$20.00` |
| `parseUsageApi(json)` | Parse the official `/zen/go/v1/usage` response into `GoUsageData` |
| `parseDashboard(html)` | Parse the `/go` dashboard HTML into `GoUsageData` |
| `parseBilling(html)` | Parse the `/billing` HTML into `ZenBillingData` |
| `discoverOpencodeKey()` | Read the `opencode-go` key from opencode's `auth.json` |
| `loadConfig(path?)` | Load config from env → `.env` → JSON → legacy paths |
| `writeConfig(config, path?)` | Atomic config write with `chmod 600` |

## Tests

Parser and config unit tests run on Node's built-in test runner (no extra dependencies):

```bash
npm test
```

Requires Node ≥22.6 (`--experimental-strip-types`). 14 tests cover `parseBilling` (including a decoy-`balance` false-match guard and parser-rot detection), `parseDashboard` regression guards, `parseUsageApi`, `discoverOpencodeKey`, `formatUsd`, and the `showZen` opt-in. Fixtures under `extensions/pi-go-bars/testdata/` are sanitised (no real credentials).

## Changelog

Latest release only; full history in [CHANGELOG.md](CHANGELOG.md).

### [0.4.0] — 2026-08-23

- **Official usage API (primary data source)**: Usage now comes from `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>`, replacing the fragile `/go` HTML scrape as the default. The key is auto-discovered from the `opencode-go` entry in opencode's own `auth.json` (`~/.local/share/opencode/auth.json` / `~/.config/opencode/auth.json`), or set explicitly via `OPENCODE_GO_API_KEY` / `.env` / JSON config. See [opencode#16513](https://github.com/anomalyco/opencode/pull/16513).
- **Dual-mode fallback**: When no API key is configured, the legacy workspace ID + auth cookie `/go` scrape is used unchanged — existing installs work with zero migration. On the API path, network/parse failures fall back to the scrape; 401/403 surface directly (invalid or non-entitled key).
- **New exports**: `parseUsageApi`, `discoverOpencodeKey`, and `fetchUsageApi` in `core.ts`, with tests for `parseUsageApi` (window mapping, invalid-shape error) and `discoverOpencodeKey` (auth.json reading).

## License

MIT
