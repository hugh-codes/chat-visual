# chat-visual

A browser-based chat and reaction replay tool for live-stream JSONL exports.

## What it does

Upload a `.jsonl` file exported from a Twitter Spaces (or compatible) live stream, optionally add a video file, and replay the chat events as a transparent video overlay:

- **Floating emoji reactions** rise up over the video area in real time, timed to the stream
- **Transparent chat overlay** shows join events and emoji reactions as bottom-left text — no background panel, just text-shadow for readability, so it looks natural on any video
- **Video player** — drag-and-drop or click to load any video file (MP4, MOV, MKV, etc.); large files up to 8 GB are streamed from disk via `URL.createObjectURL` without loading into RAM
- **Export Overlay** — records the reactions + chat to a transparent 1920×1080 WebM (VP9 alpha where supported) that you can drop onto your original video track in Premiere, DaVinci Resolve, CapCut, or any NLE
- **Playback controls** — play/pause, scrubber, and speed selector (0.5×–4×)
- **Drag-and-drop** file upload, or click to browse; includes a bundled example file

## JSONL format

Each line must be a JSON object with a top-level `kind` field:

| `kind` | Description |
|--------|-------------|
| `1` | Stream event — inner `body.type=2` carries an emoji reaction |
| `2` | Presence / join event — inner `payload.sender` has user info |

## Getting started

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` and click **Load example file** to try it with the bundled sample data.

## Build

```bash
npm run build   # outputs to dist/
```

