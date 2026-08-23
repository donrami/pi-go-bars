## [0.4.0] — 2026-08-23

### Changed
- **Official usage API (primary data source)**: Usage now comes from `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>`, replacing the fragile `/go` HTML scrape as the default. The key is auto-discovered from the `opencode-go` entry in opencode's own `auth.json` (`~/.local/share/opencode/auth.json` / `~/.config/opencode/auth.json`), or set explicitly via `OPENCODE_GO_API_KEY` / `.env` / JSON config. See [opencode#16513](https://github.com/anomalyco/opencode/pull/16513).
- **Dual-mode fallback**: When no API key is configured, the legacy workspace ID + auth cookie `/go` scrape is used unchanged — existing installs work with zero migration. On the API path, network/parse failures fall back to the scrape; 401/403 surface directly (invalid or non-entitled key).

### Added
- `parseUsageApi`, `discoverOpencodeKey`, and `fetchUsageApi` exports in `core.ts`.
- Tests for `parseUsageApi` (window mapping, invalid-shape error) and `discoverOpencodeKey` (auth.json reading); suite is now 14 tests.

## [0.3.0] — 2026-06-18
### Added
- **Zen pay-as-you-go billing (opt-in)**: New `Zen $20.00 $0.00/$50.00` segment appears beside the Go usage bars in the footer, with a full balance / monthly-spend / reload breakdown in `/gobars`. Enable with `OPENCODE_GO_SHOW_ZEN=1` or `"showZen": true` in `~/.pi/agent/pi-go-bars.json`. Reuses the existing workspace ID and auth cookie — no new credentials. The `/billing` scrape is anchored on `customerID:"cus_..."` with a depth-counted brace scan, so a future component on that page exposing its own `balance:` field cannot be silently matched. Default behaviour for existing Go-only users is unchanged.
- **Test suite**: `npm test` runs 12 unit tests covering `parseBilling`, `parseDashboard`, `formatUsd`, and the `showZen` opt-in. Uses `node:test` with Node's built-in type stripping — no new dependencies. Sanitized fixtures under `extensions/pi-go-bars/testdata/`.

### Changed
- **Generic cache helpers**: `readCacheFile<T>` / `writeCacheFile<T>` extracted so the Go-usage and Zen-billing caches share an atomic write path (tmp file + `chmod 600` + rename).


## [0.2.1] — 2026-05-09

### Changed
- **Migrated imports** from `@mariozechner/pi-*` to `@earendil-works/pi-*` to align with the pi package namespace migration.
- Bumped peerDependencies to `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.

### Fixed
- **Thinking level display**: Footer now correctly shows the user's configured thinking level (e.g. "high") instead of always showing "off". The extension reads the initial level via `pi.getThinkingLevel()` on session start and re-renders on live level changes.
- **Hidden cost for opencode-go**: Per-token cost display (`$X.XXX`) is now suppressed when the active model is opencode-go (flat-rate subscription, not token-priced).

## [0.1.0] — 2026-05-01

Initial release
