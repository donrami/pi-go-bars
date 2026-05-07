# JOURNAL — pi-go-bars

---

## 2026-05-07 — Split PR #1 into two focused PRs

**Context:** Original PR #1 from williamleong was a combined change (+238/-34) that did two things at once: (1) gate bars behind `isGoModel()`, and (2) migrate from `setWidget(belowEditor)` to `setFooter()`.

### PR A — `pr-a-is-go-model-gating`
Minimal change (1 file, +12 lines):
- Add `isGoModel()` helper checking `model.provider === "opencode-go"`
- Gate `session_start`, `turn_start` widget render on Go model check
- Hide widget in `model_select` when switching away from Go models
- Keeps the existing `setWidget(belowEditor)` approach unchanged

### PR B — `pr-b-footer-migration` (builds on PR A)
Full footer migration (+238/-34 net after PR A):
- Replace `setWidget(belowEditor)` with `setFooter()` — bars centered between stats and model
- Replicate default footer: cwd, git branch, token stats, cost, context %, model info, extension statuses
- Remove dead code: `UsageWidget` class, `calculateLayout()`, `Layout` interface
- Remove unused imports: `Component`
- Remove unused variables: `uiCtx`, `uiTheme`, `STATUS_KEY`
- Add `formatTokens()` helper for human-readable token counts
- Add `thinking_level_select` listener for displaying reasoning level
- Add `setupFooter()` / `clearFooter()` lifecycle management

### Not addressed (in either PR)
- **Internal API dependency risk** — `ctx.sessionManager`, `ctx.getContextUsage()`, `footerData.*` are undocumented. Needs maintainer confirmation.
- **Race condition on rapid `model_select`** — multiple quick switches could interleave `setupFooter`/`clearFooter`.

---

## 2026-05-07 — PR #1 review + cleanup pass

**Context:** PR #1 from williamleong — "feat: only show bars when opencode-go model is active" (+238 / -34).

### What the PR does
- Gates bars behind `isGoModel()` — only shows when `model.provider === "opencode-go"`
- Migrates from `ctx.ui.setWidget(belowEditor)` to `ctx.ui.setFooter()` — bars now live centered in the footer
- Replicates the full default footer (cwd, token stats, cost, context %, model info, extension statuses)
- Adds `thinking_level_select` listener for displaying reasoning level

### Changes applied on top of the PR

1. **Removed dead code** — `UsageWidget` class (~50 lines) and `calculateLayout()` function were only used by the old `setWidget(belowEditor)` approach. Replaced with a comment explaining the removal.

2. **Removed `stripAnsi()` helper** — `visibleWidth()` from pi-tui already handles ANSI escape codes internally. The manual regex strip was redundant and could give inconsistent results.

3. **Removed unused `uiCtx` / `uiTheme` variables** — set in lifecycle handlers but never read after the footer migration.

4. **Fixed `turn_start` handler** — the PR's version did nothing in `turn_start` (early return after model check). Added `tuiRef?.requestRender()` to match the original behavior where `renderWidget()` was called.

5. **Removed redundant try/catch in lifecycle handlers** — the `uiCtx`/`uiTheme` assignments were the only thing inside the try blocks. Without those assignments, the try/catch wrappers are unnecessary.

6. **Restored JSDoc on `fgToBgAnsi()`** — the PR stripped the helpful doc comment explaining 256-color / truecolor / fallback logic.

7. **Cleaned up unused `Component` import** — was only needed by the removed `UsageWidget` class.

8. **Fixed section comment alignment** — restored the 80-char separator line on the Detail UI Component section.

### Not fixed (out of scope for this pass)
- **Internal API dependency risk** — `ctx.sessionManager`, `ctx.getContextUsage()`, `footerData.*` are undocumented. Would need confirmation from pi maintainers.
- **Footer scope creep** — the PR replicates the entire default footer. Ideally split into two PRs (gating + footer migration), but the combined change is functional.
- **Race condition on rapid `model_select`** — multiple quick model switches could interleave `setupFooter`/`clearFooter`. Would need a guard flag or debounce.

### Next steps
- Test with `pi install path:/home/mainuser/Desktop/pi-go-bars` to verify footer renders correctly.
- Consider extracting `renderFooterBars` and `renderBarSegment` into `core.ts` to match the "pure logic in core" pattern.
