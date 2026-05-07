# JOURNAL — pi-go-bars

---

## 2026-05-07 — Split PR #1 into two focused PRs

**Context:** Original PR #1 from williamleong was a combined change (+238/-34) that did
two things at once: (1) gate bars behind `isGoModel()`, and (2) migrate from
`setWidget(belowEditor)` to `setFooter()`. Split into two PRs preserving
williamleong's authorship.

### PR #4 — `williamleong/gating-only` (author: William Leong)
Minimal change (1 file, +10 lines):
- Add `isGoModel()` helper checking `model.provider === "opencode-go"`
- Gate `session_start`, `turn_start` widget render on Go model check
- Hide widget in `model_select` when switching away from Go models
- Keeps the existing `setWidget(belowEditor)` approach unchanged

### PR #5 — `williamleong/footer-migration` (author: William Leong)
Full footer migration (+238/-34 net):
- Replace `setWidget(belowEditor)` with `setFooter()` — bars centered between stats and model
- Replicate default footer: cwd, git branch, token stats, cost, context %, model info, extension statuses
- Remove dead code: `UsageWidget` class, `calculateLayout()`, `Layout` interface
- Add `formatTokens()` helper for human-readable token counts
- Add `thinking_level_select` listener for displaying reasoning level
- Add `setupFooter()` / `clearFooter()` lifecycle management
- Fix: `turn_start` now triggers re-render (was missing in commit 1)

### Not addressed (in either PR)
- **Internal API dependency risk** — `ctx.sessionManager`, `ctx.getContextUsage()`, `footerData.*` are undocumented. Needs maintainer confirmation.
- **Race condition on rapid `model_select`** — multiple quick switches could interleave `setupFooter`/`clearFooter`.
