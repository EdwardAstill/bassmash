# HTTP API

FastAPI server mounted at `/`. REST endpoints live under `/api`; everything else is static assets for the browser frontend (`app/`).

Path params (`{name}`, `{filename}`) are validated with `_safe_name` (regex `^[A-Za-z0-9._-]+$` + reject `.` / `..`) and `_resolve_inside` (`Path.resolve().relative_to(root.resolve())`). Traversal attempts return HTTP 400.

Base URL assumed to be `http://localhost:8000` for the examples below.

---

## Projects

### `GET /api/projects`

List every project with a `project.json` under `$BASSMASH_PROJECTS_DIR`.

```bash
curl http://localhost:8000/api/projects
# → ["demo-beat","my-song","trap-demo"]
```

### `POST /api/projects`

Create an empty project.

```bash
curl -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-song"}'
# 201 → {"name":"my-song"}
# 400 → invalid name (regex / reserved . ..) or project already exists
```

### `GET /api/projects/{name}`

Full project dump. Response is the raw JSON file content — see [project-format.md](./project-format.md) for the schema.

```bash
curl http://localhost:8000/api/projects/my-song
# 200 → { "bpm": 140, "tracks": [...], ... }
# 404 → project not found
```

### `PUT /api/projects/{name}`

Replace the project's contents. Atomic write — tmp file + fsync + `os.replace`, delegated to `cli/store.py::write_project`. Response carries the resulting mtime so the browser can tell its own writes apart from external edits on the SSE stream.

```bash
curl -X PUT http://localhost:8000/api/projects/my-song \
  -H 'Content-Type: application/json' \
  -d @updated-project.json
# 200 → {"status":"saved","mtime_ns":1697389245123456789}
# 404 → project not found
```

### `DELETE /api/projects/{name}`

Remove the project directory and everything in it.

```bash
curl -X DELETE http://localhost:8000/api/projects/my-song
# 200 → {"deleted":"my-song"}
# 404 → not found
```

---

## Project events (SSE)

### `GET /api/projects/{name}/events`

Server-sent events stream. Polls `project.json`'s mtime every 500 ms; emits a payload on every change.

```bash
curl -N http://localhost:8000/api/projects/my-song/events
#
# data: {"type":"hello","name":"my-song","mtime_ns":1697389245123456789}
#
# data: {"type":"project-updated","name":"my-song","mtime_ns":1697389246987654321}
#
# data: {"type":"project-deleted","name":"my-song"}
```

Message types:

| `type`              | Meaning                                                                         |
|---------------------|---------------------------------------------------------------------------------|
| `hello`             | Emitted once on subscribe with the current `mtime_ns`.                          |
| `project-updated`   | Emitted on every subsequent mtime change, with the new `mtime_ns`.              |
| `project-deleted`   | File disappeared. Stream closes after this frame.                               |

Consumers keep the connection open indefinitely; the server uses `is_disconnected()` to clean up on client close.

Browser side: [`app/js/api.js::subscribeProject`](../app/js/api.js) wraps `EventSource`.

---

## Samples (drum one-shots inside a project)

### `POST /api/projects/{name}/samples`

```bash
curl -X POST http://localhost:8000/api/projects/my-song/samples \
  -F file=@./kick.wav
# 201 → {"filename":"kick.wav"}
```

Multipart upload. Only the basename of `file.filename` is used; any path components are stripped before the sanitised name is validated.

### `GET /api/projects/{name}/samples/{filename}`

Serves the file with `Content-Type: audio/wav`.

```bash
curl -o out.wav http://localhost:8000/api/projects/my-song/samples/kick.wav
# 200 → raw bytes
# 400 → traversal attempt rejected
# 404 → file not found
```

---

## Audio (full-length uploaded clips)

### `GET /api/projects/{name}/audio`

List audio files in the project's `audio/` folder. Filters to `.mp3 .wav .ogg .flac .aif .aiff`.

```bash
curl http://localhost:8000/api/projects/my-song/audio
# 200 → ["loop.wav","vocals.mp3"]
```

### `POST /api/projects/{name}/audio`

```bash
curl -X POST http://localhost:8000/api/projects/my-song/audio \
  -F file=@./loop.wav
# 201 → {"filename":"loop.wav"}
```

### `GET /api/projects/{name}/audio/{filename}`

Streams the file with the appropriate `Content-Type` based on extension.

### `PUT /api/projects/{name}/audio/{filename}`

Rename.

```bash
curl -X PUT http://localhost:8000/api/projects/my-song/audio/old.mp3 \
  -H 'Content-Type: application/json' \
  -d '{"newName":"new.mp3"}'
# 200 → {"filename":"new.mp3"}
# 400 → newName is a traversal attempt or invalid regex
# 404 → source not found
# 409 → target filename already exists
```

### `DELETE /api/projects/{name}/audio/{filename}`

```bash
curl -X DELETE http://localhost:8000/api/projects/my-song/audio/loop.wav
# 200 → {"deleted":"loop.wav"}
# 404 → not found
```

---

## Built-in kit

### `GET /api/kit`

```bash
curl http://localhost:8000/api/kit
# 200 → ["kick-808.wav","snare-trap.wav",...]
```

Lists entries under `$BASSMASH_KIT_DIR` with extension `.wav` or `.mp3`.

### `GET /api/kit/{filename}`

Serves the kit sample bytes (`Content-Type: audio/wav`).

---

## Export

### `POST /api/projects/{name}/export`

```
POST /api/projects/my-song/export
Content-Type: audio/wav
Body: <raw WAV bytes from OfflineAudioContext render>

→ Content-Type: audio/mpeg
→ Content-Disposition: attachment; filename="my-song.mp3"
→ Body: <MP3 bytes>
```

The frontend renders the arrangement offline via [`app/js/audio/offline-render.js`](../app/js/audio/offline-render.js), POSTs the WAV blob here, and the server shells out to `ffmpeg -b:a 192k`.

Errors:
- **400** — empty body.
- **500 "ffmpeg not found"** — install ffmpeg system-wide.
- **500 "ffmpeg error: …"** — encoding failed; stderr included in the detail.

---

## Error shape

All errors use FastAPI's default JSON:

```json
{"detail": "<message>"}
```

Status codes in use: `200 OK`, `201 Created`, `400 Bad Request` (traversal, invalid name, empty export body), `404 Not Found`, `409 Conflict` (rename target exists), `500 Internal Server Error` (ffmpeg only).

---

## CORS

Permissive by default — `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]`. Intended for local single-user use. Lock down before exposing over the public internet.

## Cache-Control

`.js`, `.css`, and `.html` responses carry `no-cache, no-store, must-revalidate`. Keeps frontend edits visible on reload without stale-asset surprises during development.

Every other response uses FastAPI / StaticFiles defaults.

---

## Environment

| Variable | Effect |
|---|---|
| `BASSMASH_PROJECTS_DIR` | Where projects live. Default `~/bassmash-projects`. |
| `BASSMASH_KIT_DIR` | Where built-in kit samples live. Default `<repo>/kit`. |

Both are respected by `cli/store.py`, so the server + CLI + MCP all agree.
