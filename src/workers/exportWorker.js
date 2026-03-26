/**
 * Web Worker: off-screen H.264/MP4 export.
 *
 * Runs the entire encode loop on a worker thread so the UI stays responsive
 * and the encoder gets the full CPU budget. The main thread creates an
 * OffscreenCanvas, transfers it here, then receives progress / done / error
 * messages back.
 *
 * Expected inbound message (only one, to start the job):
 *   { canvas: OffscreenCanvas, events: Array, minTime: number, duration: number }
 *   The canvas is transferred (zero-copy) via the transferable list.
 *
 * Outbound messages:
 *   { type: 'progress', value: number }   — 0–1
 *   { type: 'done',     buffer: ArrayBuffer } — transferred (zero-copy)
 *   { type: 'error',    error: string }
 */

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
} from 'mediabunny';
import { REACTION_LIFETIME, reactionLeft } from '../utils/overlayConstants';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const EXPORT_FPS = 30;
const FRAME_DURATION = 1 / EXPORT_FPS; // seconds

// ── Draw one frame to the OffscreenCanvas ────────────────────────────────────
function drawFrame(ctx, events, minTime, offsetMs) {
  const W = CANVAS_WIDTH;
  const H = CANVAS_HEIGHT;
  const nowMs = offsetMs + minTime;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // ── Chat messages ──────────────────────────────────────────────────────────
  const pad = 24;
  const fontSize = 28;
  const smallFont = fontSize - 5;
  const lineH = 44;
  const maxChatW = 500;

  const visible = events.filter((e) => e.timestamp != null && e.timestamp <= nowMs);
  const maxRows = Math.floor((H * 0.6) / lineH);
  const recent = visible.slice(-maxRows);

  recent.forEach((e, i) => {
    const y = H - pad - (recent.length - 1 - i) * lineH;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    if (e.type === 'join') {
      ctx.font = `${smallFont}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`${e.displayName} joined`, pad, y, maxChatW);
    } else {
      ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#b98bff';
      const nameW = Math.min(ctx.measureText(e.displayName).width, maxChatW - 60);
      ctx.fillText(e.displayName, pad, y, maxChatW - 60);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(':', pad + nameW + 4, y);
      // Emoji glyphs render better slightly larger than the surrounding text
      ctx.font = `${fontSize + 6}px serif`;
      ctx.fillText(e.emoji, pad + nameW + 4 + ctx.measureText(':').width + 10, y);
    }
    ctx.restore();
  });

  // ── Floating emoji reactions ───────────────────────────────────────────────
  ctx.font = '54px serif';

  events.forEach((e) => {
    if (e.type !== 'reaction') return;
    if (e.timestamp == null || e.timestamp > nowMs) return;
    const elapsed = nowMs - e.timestamp;
    if (elapsed > REACTION_LIFETIME) return;

    const progress = elapsed / REACTION_LIFETIME;
    const eased = 1 - (1 - progress) ** 2;
    const x = (reactionLeft(e.id) / 100) * (W - 70);
    const y = H - 70 - eased * Math.round(H * 0.28);

    let alpha;
    if (progress < 0.15) alpha = progress / 0.15;
    else if (progress < 0.8) alpha = 1;
    else alpha = 1 - (progress - 0.8) / 0.2;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 10;
    ctx.fillText(e.emoji, x, y);
    ctx.restore();
  });
}

// ── Main encode loop ──────────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
  const { canvas, events, minTime, duration } = data;

  try {
    const ctx = canvas.getContext('2d');
    const totalFrames = Math.ceil(duration * EXPORT_FPS);

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });

    // CanvasSource handles WebCodecs VideoEncoder internally and propagates
    // backpressure via the promise returned by add().
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: 4_000_000,
    });
    output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });
    await output.start();

    for (let i = 0; i < totalFrames; i++) {
      const offsetMs = (i / EXPORT_FPS) * 1000;
      drawFrame(ctx, events, minTime, offsetMs);

      // Awaiting add() automatically respects encoder + muxer backpressure
      // without any setTimeout polling — this is the key speedup vs the old
      // manual VideoEncoder loop.
      await videoSource.add(i * FRAME_DURATION, FRAME_DURATION, {
        // A key frame every 150 frames (5 s at 30 fps) balances seekability
        // against file size — shorter streams need a key frame near the start.
        keyFrame: i % 150 === 0,
      });

      // Post progress once per second of encoded content
      if (i % EXPORT_FPS === 0) {
        self.postMessage({ type: 'progress', value: i / totalFrames });
      }
    }

    videoSource.close();
    await output.finalize();

    // Transfer the ArrayBuffer zero-copy back to the main thread
    const buffer = output.target.buffer;
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  }
};
