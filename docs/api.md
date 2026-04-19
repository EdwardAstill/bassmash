# HTTP API

FastAPI server mounted at `/`. REST endpoints live under `/api`; everything else is static files (the browser frontend).

All project / filename path params are validated against `^[A-Za-z0-9._-]+$` and resolved with path-traversal guards, so `../` and absolute paths are rejected with 400.

## Projects

| Verb | Path | Body | Response |
|------|------|------|----------|
| `GET`    | `/api/projects`              | — | `["name", …]` sorted |
| `POST`   | `/api/projects`              | `{"name": "<n>"}` | 201 `{"name": "<n>"}` · 400 if exists / invalid |
| `GET`    | `/api/projects/{name}`       | — | Full `project.json` · 404 if missing |
| `PUT`    | `/api/projects/{name}`       | full project JSON | `{"status": "saved", "mtime_ns": <int>}` — atomic write via tempfile + fsync + rename. The browser uses `mtime_ns` to ignore its own SSE echo. |
| `DELETE` | `/api/projects/{name}`       | — | `{"deleted": "<n>"}` — removes dir + contents |

## Project events (SSE)

```
GET /api/projects/{name}/events
Content-Type: text/event-stream
```

Polls `project.json`'s mtime every 500 ms and pushes JSON payloads:

```js
data: {"type": "hello", "name": "<n>", "mtime_ns": <int>}
data: {"type": "project-updated", "name": "<n>", "mtime_ns": <int>}
data: {"type": "project-deleted", "name": "<n>"}    // stream ends after this
```

Browsers subscribe via `EventSource` (see `app/js/api.js::subscribeProject`). Cleans up on client disconnect.

## Samples (drum one-shots inside the project)

| Verb | Path | Notes |
|------|------|-------|
| `POST` | `/api/projects/{name}/samples` · multipart `file` | 201 `{"filename": "<f>"}` — filename is sanitised to basename; traversal rejected |
| `GET`  | `/api/projects/{name}/samples/{filename}` | File response (`audio/wav`) · 400 traversal · 404 missing |

## Audio (uploaded tracks used as audio clips)

| Verb | Path | Notes |
|------|------|-------|
| `GET`    | `/api/projects/{name}/audio` | Sorted list of `.mp3 .wav .ogg .flac .aif .aiff` |
| `POST`   | `/api/projects/{name}/audio` · multipart `file` | 201 |
| `GET`    | `/api/projects/{name}/audio/{filename}` | File response with correct media type |
| `PUT`    | `/api/projects/{name}/audio/{filename}` · `{"newName": "<f>"}` | 200 · 404 if missing · 409 if target exists · 400 traversal |
| `DELETE` | `/api/projects/{name}/audio/{filename}` | 200 · 404 if missing |

## Built-in kit

| Verb | Path | Notes |
|------|------|-------|
| `GET` | `/api/kit` | Sorted list of kit samples (`.wav`, `.mp3`) |
| `GET` | `/api/kit/{filename}` | File response (`audio/wav`) |

## Export

```
POST /api/projects/{name}/export
Content-Type: audio/wav
Body: raw WAV bytes (the OfflineAudioContext render)

→ Content-Type: audio/mpeg
→ Body: MP3 bytes (filename `{name}.mp3`)
```

The frontend bounces the arrangement offline via `app/js/audio/offline-render.js`, posts the WAV here, and the server shells out to `ffmpeg -b:a 192k` for the MP3 encode. Empty bodies return 400; missing ffmpeg returns 500 with a specific error message.

## Error shape

All errors return FastAPI's default `{"detail": "<message>"}` JSON with the appropriate status.

## CORS

Permissive by default (`allow_origins=["*"]`) — single-user local dev. Lock down before exposing publicly.

## Cache-Control

`.js`, `.css`, `.html` responses carry `no-cache, no-store, must-revalidate` so edits show up on reload without stale-asset surprises during development.
