# chat-visual

A browser-based chat and reaction replay tool for live-stream JSONL exports.

## What it does

Upload a `.jsonl` file exported from a Twitter Spaces (or compatible) live stream and replay the chat events in a Twitch-style interface:

- **Floating emoji reactions** rise up over the video area in real time
- **Scrolling chat panel** shows join events and reactions in chronological order
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

