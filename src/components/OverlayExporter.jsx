import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const REACTION_LIFETIME = 3000; // ms — must match ChatOverlay
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const EXPORT_FPS = 30;

// ── Deterministic horizontal position for canvas rendering ─────────────────
// Hash-based so the same reaction always appears at the same x-position
// across every render, making the encode seek-stable.
function reactionLeft(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 5 + (Math.abs(h) % 70); // 5 – 75 %
}

// ── Draw one frame to an off-screen canvas ─────────────────────────────────
// offsetMs: relative playback offset (0 → duration*1000)
// Black background so the file composites cleanly in any NLE using
// Screen / Add / Lighten blend mode (equivalent to alpha compositing for
// light-coloured overlays on dark-coloured backgrounds).
function drawFrame(ctx, events, minTime, offsetMs) {
  const W = CANVAS_WIDTH;
  const H = CANVAS_HEIGHT;
  const nowMs = offsetMs + minTime;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // ── Chat messages ────────────────────────────────────────────────────────
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
      ctx.font = `${fontSize + 6}px serif`;
      ctx.fillText(e.emoji, pad + nameW + 4 + ctx.measureText(':').width + 10, y);
    }
    ctx.restore();
  });

  // ── Floating emoji reactions ─────────────────────────────────────────────
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

// ── Fast offline H.264/MP4 encode via WebCodecs ────────────────────────────
// Renders every frame to canvas at maximum CPU speed — typically 10–50× faster
// than real-time, making even a 2-hour overlay practical to export.
async function runFastExport(canvas, events, minTime, durationS, abortRef, onProgress, onDone) {
  const ctx = canvas.getContext('2d');
  const totalFrames = Math.ceil(durationS * EXPORT_FPS);

  // Pick the best supported H.264 codec profile available in this browser
  let codec = null;
  for (const c of ['avc1.640028', 'avc1.4d002a', 'avc1.42001e']) {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: c, width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
    });
    if (supported) { codec = c; break; }
  }
  if (!codec) throw new Error('No supported H.264 codec found in this browser.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({
    codec,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    bitrate: 4_000_000,
    framerate: EXPORT_FPS,
  });

  for (let i = 0; i < totalFrames; i++) {
    if (abortRef.current) { encoder.close(); return; }

    const offsetMs = (i / EXPORT_FPS) * 1000;
    drawFrame(ctx, events, minTime, offsetMs);

    const frame = new VideoFrame(canvas, { timestamp: Math.round(offsetMs * 1000) });
    encoder.encode(frame, { keyFrame: i % 150 === 0 });
    frame.close();

    // Respect encoder backpressure
    while (encoder.encodeQueueSize > 30) {
      await new Promise((r) => setTimeout(r, 1));
      if (abortRef.current) { encoder.close(); return; }
    }

    // Yield to the UI thread every second of encoded content
    if (i % EXPORT_FPS === 0) {
      await new Promise((r) => setTimeout(r, 0));
      onProgress(i / totalFrames);
    }
  }

  await encoder.flush();
  muxer.finalize();
  encoder.close();

  onDone(new Blob([target.buffer], { type: 'video/mp4' }));
}

/**
 * OverlayExporter — off-screen canvas component that exports the chat+reaction
 * overlay as a 1920×1080 MP4 without requiring the video to play in real-time.
 *
 * Fast path  (Chrome/Edge/Safari with WebCodecs): offline H.264 encode.
 *   Typical speed: 10–50× faster than real-time.
 *   Output: MP4 with black background — use "Screen" blend mode in your NLE.
 */
export default function OverlayExporter({ events, minTime, duration, exporting, onProgress, onDone }) {
  const canvasRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!exporting) {
      abortRef.current = true;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    abortRef.current = false;

    if (typeof VideoEncoder === 'undefined') {
      onProgress({ error: 'WebCodecs (VideoEncoder) is not available in this browser. Please use Chrome 94+ or Edge 94+.' });
      return;
    }

    runFastExport(canvas, events, minTime, duration, abortRef, onProgress, onDone).catch((err) => {
      if (!abortRef.current) onProgress({ error: String(err) });
    });

    return () => {
      abortRef.current = true;
    };
  }, [exporting, events, minTime, duration, onProgress, onDone]);

  return (
    // Canvas is fully off-screen — the progress bar in App.jsx shows status
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{ display: 'none' }}
    />
  );
}

OverlayExporter.propTypes = {
  events: PropTypes.array.isRequired,
  minTime: PropTypes.number.isRequired,
  duration: PropTypes.number.isRequired, // seconds
  exporting: PropTypes.bool.isRequired,
  onProgress: PropTypes.func.isRequired, // (0-1 | { error: string }) => void
  onDone: PropTypes.func.isRequired,     // (Blob) => void
};

