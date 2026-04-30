# Development Guide

## One-time setup

```bash
git clone https://github.com/EdwardAstill/m8s.git
cd m8s

uv sync                               # backend + tests (FastAPI + librosa + pytest)
uv tool install --editable .          # puts `m8s-cli` on $PATH (tracks the source)

# Optional — only for the `bun run dev` helpers in package.json. The server
# runs fine via `uv run uvicorn server.main:app` without bun.
bun install
```

`ffmpeg` must be available on PATH for the MP3 export endpoint.

### MCP server (optional)

```bash
cd mcp-server && uv sync
```

Then wire it into your MCP client — see [`mcp.md`](./mcp.md#connect-it).

---

## Run

```bash
bun run dev                           # uvicorn --reload on :8000
# — or —
uv run uvicorn server.main:app --reload --port 8000
```

Frontend is served from `app/` as static files. Backend watches `server/` and `cli/` on reload.

Open `http://localhost:8000`, click anywhere once to unlock audio.

### Three authoring surfaces

All three converge on `~/m8s-projects/<name>/project.json` via `cli/store.py`'s atomic write:

- **Browser** — direct UI, drag-and-drop, autosaves every 2 s (max-delay 10 s during continuous edits).
- **CLI** — `m8s-cli bpm set …` / `pattern step-row …` / etc. See [`cli.md`](./cli.md).
- **MCP** — structured tool calls for AI agents. See [`mcp.md`](./mcp.md).

Any write fires a server-sent event → open browser tabs re-fetch → inspector focus + selection preserved.

---

## Tests

```bash
uv run pytest                         # 119 tests, ~1 s
uv run pytest -q server/              # HTTP routes + SSE + path traversal
uv run pytest -q cli/                 # store atomicity, ops invariants, Typer CLI integration
uv run pytest -q -k send_audio        # pattern filter
```

Layout:

| Suite | Count | What it covers |
|---|---|---|
| `server/test_routes.py`    | 47 | REST endpoints: projects CRUD, samples, audio, kit, export, SSE content-type + hello payload, rename/delete with 404 / 409 / path-traversal cases, atomic-write delegation to `cli.store`. |
| `cli/test_store.py`        | 17 | Env-var override, atomic writes under simulated crash, extension filtering. |
| `cli/test_project_ops.py`  | 35 | BPM bounds, track add/remove with arrangement reindex, pattern upsert by name, note validation, demo-tune idempotence. |
| `cli/test_main.py`         | 21 | End-to-end Typer invocations through the full stack. |

No frontend test suite yet. Use the headless smoke below as a regression check before merging UI changes.

### Headless smoke

```bash
uv pip install playwright
uv run playwright install firefox

# With the dev server on :8000
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

Expected: `{"errors": []}`. Any non-empty array is a regression.

---

## Architecture

High-level layers:

```
┌─────────────── browser ────────────────┐
│  UI zones + workbench panes + mixer    │
│  ↓ mutations        ↑ SSE reloads      │
│  autosave PUTs      loaded events      │
└────┬──────────────────────────┬────────┘
     │                          │
     ▼                          ▼
┌──────────────┐        ┌──────────────────┐
│  FastAPI     │        │ EventSource      │
│  server/     │        │ /api/.../events  │
│  routes.py   │        │ (mtime poll)     │
└──────┬───────┘        └──────┬───────────┘
       │                       │
       └──────── cli/store.py ─┘        ← single disk-IO authority
                     │
                     ▼
        ~/m8s-projects/<n>/project.json   (atomic write)
                     ▲
                     │
       ┌─────────────┴─────────────┐
       │                           │
  cli/main.py                 mcp-server/server.py
  (Typer CLI)                 (MCP tools for AI)
```

### The frontend model

- **No bundler, no transpiler, no TypeScript.** Raw ES modules served straight from `app/`. Every `<script type="module">` import is a real HTTP request.
- **Event-bus state.** `state.js::StateStore` owns `store.data`. UI zones listen to `store.on('change' | 'loaded' | 'trackSelected' | 'clipSelected' | 'beat' | …)` and re-render.
- **Autosave.** `store._scheduleSave` — 2 s trailing debounce + 10 s max-delay. Every save records its `mtime_ns` so the SSE subscription can tell external edits apart.
- **Audio is a single graph.** `audio/engine.js` owns the `AudioContext`. `mixer.js` + `effects.js` + `sampler.js` build the graph once and mutate params over time. `scheduler.js` fires per 16th-note `beat` events that drive sampler triggers, audio-clip BufferSources, and automation ramps.
- **Offline render mirrors the live scheduler** ([`audio/offline-render.js`](../app/js/audio/offline-render.js)). Any scheduler change needs a matching offline change so the MP3 bounce can't drift from playback. `audio/automation-util.js::clampAutomationValue` is deliberately shared between the two.

### Shared helpers worth knowing

| File | What |
|---|---|
| `app/js/ui/knob.js` | Single vertical-drag knob implementation. Used by inspector, sampler pads, bus FX knobs, synth-panel filter knobs. |
| `app/js/ui/context-menu.js` | Right-click menu — viewport clamp + Esc + outside-click. Used by track-manager and global-strip. |
| `app/js/ui/modal.js` | Async `confirm()` / `prompt()` with inline validation. Replaces `window.prompt`/`confirm`. |
| `app/js/audio/tempo.js` | `bpmAtBeat(data, beat)` shared by engine, scheduler, offline-render, global-strip. |
| `app/js/audio/automation-util.js` | `clampAutomationValue(paramKey, v)` for per-param safe ranges. |
| `app/js/audio/audio-cache.js` | Promise-backed decoded `AudioBuffer` cache keyed by URL. |
| `app/js/audio/waveform-peaks.js` | LRU-cached decimated peaks for audio clip canvases. |

Before you write a new helper, grep these first.

### CSS conventions

- Design tokens live in `app/css/style.css` as CSS variables (`--surface-raised`, `--c-subtle`, `--accent`, `--err`, `--radius-md`, `--space-2`…). Use them; don't hand-pick values.
- Per-feature blocks are demarcated `/* === Feature name === */ … /* === /Feature name === */`. Makes parallel agent edits easy to review.

### Event bus catalog

These are the store events the app actually consumes — add new ones sparingly:

`change · loaded · saving · saved · saveFailed · transport · beat · tick · engineReady · trackSelected · clipSelected · toolChanged · seek · audioFilesChanged · sendChanged · loopChanged · loopWrap · mixerLiveGain`

`change` payloads take `{ path, value? }` so listeners can filter on the `path` prefix (`"tracks"`, `"arrangement"`, `"patterns"`, `"bpm"`, `"markers"`, `"tempoChanges"`, `"busMix"`).

---

## Making changes safely

### Backend changes

1. Write the test first in `server/test_routes.py` or `cli/test_*.py`.
2. If it's a new REST endpoint, also update [`api.md`](./api.md).
3. If it's a new `cli/store.py` operation, mirror it in the MCP server and update [`mcp.md`](./mcp.md).
4. `uv run pytest` must stay green.

### Frontend changes

1. Do the minimal change. Respect the shared helpers (see table above).
2. Keep CSS additions inside a demarcated block.
3. Run the headless smoke against a fresh project. Zero console errors.
4. If you changed the store shape, update [`project-format.md`](./project-format.md).

### Adding a new MCP tool

1. Define a `@mcp.tool()` function in `mcp-server/server.py` with `Annotated[...]` arg descriptions.
2. Route every write through `_save_project(name, proj)` — atomic, creates `samples/` and `audio/`.
3. Re-use invariants from `cli/project_ops.py` where shapes overlap.
4. Self-test by importing `server` and calling the function directly — no MCP host needed.
5. Update the tool catalog in [`mcp.md`](./mcp.md).
6. Restart your MCP client to pick up the new tool (stdio servers don't hot-reload).

---

## Git hygiene

- Conventional commits — `feat:`, `fix:`, `refactor:`, `perf:`, `docs:`, `test:`. Lowercase imperative.
- Tight scopes — one intent per commit. Mixed-intent commits are hard to review.
- `main` is the working branch; push small commits, don't hoard.
- Don't re-commit under `--amend` on already-pushed commits without a good reason.
- Co-author Claude when it contributed materially:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Contributing

1. One focused branch/PR per feature or fix.
2. `uv run pytest` green. Headless smoke zero errors.
3. If you ship something on `NEXT_STEPS.md` or add a new known gap, update that doc.
4. New user-facing surface = new docs entry:
   - CLI subcommand → [`cli.md`](./cli.md)
   - MCP tool → [`mcp.md`](./mcp.md)
   - HTTP endpoint → [`api.md`](./api.md)
   - project.json shape → [`project-format.md`](./project-format.md)
5. When in doubt, open a draft PR and ping. M8S is a personal DAW — the design rope is long, but stability of the store shape, the MCP tool catalog, and the REST API is the contract.
