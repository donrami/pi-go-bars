# Contributing

Thanks for taking a look. pi-go-bars is a small, single-maintainer pi extension — see the [README](README.md) for what it does and how it works. This file covers how to report problems and get changes merged.

## Where to ask questions

Open a [GitHub issue](https://github.com/donrami/pi-go-bars/issues). Bugs, feature requests, and "how do I…" questions all belong there. Replies may take a few days — this is a side project.

## Reporting issues

Before filing, search existing issues for the same problem.

**Bugs** — include:

- pi version (`pi --version`) and your OS/terminal
- Extension version (from `package.json` or [CHANGELOG.md](CHANGELOG.md))
- Credential mode: API key (auto-discovered or `OPENCODE_GO_API_KEY`) or the legacy cookie fallback — and whether Zen billing (`OPENCODE_GO_SHOW_ZEN`) is enabled, since it always uses cookies
- Steps to reproduce, expected vs actual output
- The exact error text — e.g. `HTTP 401/403` (key problem) vs `parser may be outdated` (opencode's HTML changed)

**Feature requests** — describe the use case, not the implementation. It helps to say which window/segment it concerns (Go usage, Zen billing, rendering).

## Development setup

Prerequisites: Node >= 22.6 (needed for `--experimental-strip-types`), git.

```bash
git clone https://github.com/donrami/pi-go-bars.git
cd pi-go-bars
npm install
npm test
```

To try changes inside pi:

```bash
pi install .
```

For manual testing with real credentials, copy `.env.example` to `.env` in the repo root — it is auto-detected from the working directory. There is no build step: the extension runs directly via type stripping.

## Project layout

| Path | Purpose |
|---|---|
| `extensions/pi-go-bars/index.ts` | Entry point: registers commands and the footer widget |
| `extensions/pi-go-bars/core.ts` | Fetching, parsing, config, exported utilities |
| `extensions/pi-go-bars/setup.ts` | `/gobars-setup` walkthrough |
| `extensions/pi-go-bars/core.test.ts` | Test suite (`node:test`) |
| `extensions/pi-go-bars/testdata/` | Sanitised HTML fixtures — no real credentials |

## Code style

TypeScript, `node:` imports, zero runtime dependencies, 2-space indent, double quotes, semicolons. Public functions in `core.ts` get JSDoc. Tests use `node:test` and `node:assert` with fixtures under `testdata/`.

Match the surrounding style; there is no linter config, so the existing files are the reference.

## Pull requests

- Fork, create a branch, and keep the PR small — one concern per PR.
- Run `npm test` before opening; the suite must pass.
- Reference the issue number in the PR description when one exists.
- Solo maintainer: review may take a few days. Green tests and a focused diff land fastest.

## Commit style

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`), a concise subject describing what changed, and the issue/PR number in parentheses when relevant — as seen in the git history.

## Releasing

Maintainer-side. Version bumps follow semver; each release gets a `CHANGELOG.md` entry (the README changelog keeps the latest release only), the version in `package.json` is bumped, and the release is tagged and published to npm.

## License

MIT — see [LICENSE](LICENSE).

## Code of conduct

Be civil and constructive; disagreements are fine, personal attacks are not. Reports are handled through [GitHub issues](https://github.com/donrami/pi-go-bars/issues) — this project has no formal enforcement process beyond that.
