# Development Guide

## Setup

```bash
git clone https://github.com/EdwardAstill/bassmash.git
cd bassmash
uv sync                               # FastAPI + librosa + pytest
uv tool install --editable .          # installs `bassmash-cli` globally
bun install                           # optional — only for `bun run dev` helpers
```

Install `ffmpeg` system-wide — the MP3 export endpoint shells out to it.

## Run

```bash
bun run dev                           # uvicorn --reload on :8000
# — or —
uv run uvicorn server.main:app --reload --port 8000
```

Static assets and the frontend are served from `app/`; the backend watches `server/` + `cli/` on reload.

## Tests

```bash
uv run pytest                         # 119 tests, ~1 s
uv run pytest -q server/              # HTTP routes + SSE headers + path traversal
uv run pytest -q cli/                 # store atomicity, project_ops invariants, Typer integration
```

Backend coverage:

- `server/test_routes.py` (46) — projects, samples, audio, kit, export, SSE hello, rename/delete, path-traversal rejection, atomic-write delegation
- `cli/test_store.py` (17) — env override, atomic writes under simulated crash, extension filtering
- `cli/test_project_ops.py` (35) — BPM bounds, track add/remove with arrangement reindex, pattern upsert, note validation, demo-tune idempotence
- `cli/test_main.py` (21) — end-to-end Typer CLI invocations through the full stack

There's no frontend test suite yet. Use the headless Playwright walkthrough below as a regression check before merging UI changes.

### Headless smoke

```bash
uv pip install playwright
uv run playwright install firefox

# with the dev server running on :8000
uv run python - <<'PY'
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        b = await pw.firefox.launch(headless=True)
        p = await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.on('console',   lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        await p.goto('http://localhost:8000/', wait_until='networkidle')
        await p.locator('body').click()
        await p.wait_for_timeout(1500)
        print(json.dumps({'errors': errs}, indent=2))
        await b.close()
asyncio.run(main())
PY
```

Expected output: `{"errors": []}`. Any non-empty list is a regression — investigate.

## Architecture

See [`../NEXT_STEPS.md`](../NEXT_STEPS.md) for the full snapshot: store shape, event-bus catalog, module layout, deferred items.

Quick mental model:

- **`cli/store.py`** is the single disk-IO authority. Both the HTTP backend and the `bassmash-cli` command route through it. Every write is atomic (tempfile + fsync + os.replace). No duplicate serialization code anywhere else.
- **`cli/project_ops.py`** are pure-function mutations on a project dict. The CLI, the MCP server, and (via imports) any future caller share these invariants.
- **`app/js/audio/offline-render.js`** mirrors **`scheduler.js`** beat-for-beat against an `OfflineAudioContext`. They're not DRY'd because the live path is fire-once-per-beat and the offline path walks the timeline up-front — refactoring them into one abstraction would cost more than it saves. Instead: changes to one get mirrored to the other; `automation-util.js` shares the clamp logic.
- **SSE** (`/api/projects/{name}/events`) tails `project.json`'s mtime every 500 ms so CLI edits and browser edits stay in sync. The browser tags its own PUTs with the returned `mtime_ns` and ignores echoes.

## Conventions

- **ES modules** throughout the frontend. No bundler, no transpiler. If you need `window.foo` for devtools, expose on `window.bassmash` (see `app/js/main.js`).
- **No third-party JS deps.** Vanilla DOM, Web Audio, Canvas, EventSource. Keeps the runtime understandable and the module graph small.
- **Design tokens** live in `app/css/style.css` as CSS variables (`--surface-raised`, `--c-subtle`, `--accent`, etc.) — use them; don't hand-pick colors.
- **Per-feature CSS blocks** are marked `/* === <feature> === */ … /* === /<feature> === */` so diffs are easy to scope when agents are adding styles in parallel.
- **Autosave debounce** — state mutations should flow through existing event emissions (`store.emit('change', {path:'<key>'})`) and let `state.js::_scheduleSave` debounce. Don't re-invent.
- **Shared helpers** — before writing a new helper, grep. There's already one for knobs (`app/js/ui/knob.js`), context menus (`context-menu.js`), modals (`modal.js`), tempo (`audio/tempo.js`), and automation value clamping (`audio/automation-util.js`).

## Git hygiene

- Conventional commits — `feat:`, `fix:`, `refactor:`, `perf:`, `docs:`, `test:`. Lowercase imperative.
- Tight scopes. Mixed-intent commits (feat + refactor + docs in one) are hard to review. Split.
- `main` is protected by convention — push small, reviewable commits.
- Co-author Claude when it contributed materially (`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`).

## Contributing

1. Small, focused PRs — one feature or fix per branch.
2. Keep `NEXT_STEPS.md` current when you ship something on its list or add a new known gap.
3. Run `uv run pytest` before pushing.
4. For any UI change, run the headless smoke and confirm zero console errors.
5. If you add a CLI subcommand, also update `docs/cli.md`. If you add an MCP tool, update `docs/mcp.md`. If you add an HTTP endpoint, update `docs/api.md`.
