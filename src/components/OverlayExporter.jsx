import { useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

const REACTION_LIFETIME = 3000; // ms — must match ChatOverlay
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/**
 * Deterministic horizontal position (%) for a reaction based on its id.
 *
 * The canvas export uses a hash-based position rather than Math.random() so
 * that reactions appear at the same horizontal spot every time the same moment
 * is rendered (seek-stable). The React ChatOverlay uses Math.random() for a
 * more natural feel during live playback — these are intentionally different.
 */
function reactionLeft(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 5 + (Math.abs(h) % 70); // 5 – 75 %
}

/**
 * Records the chat + reaction overlay to a transparent WebM using
 * canvas.captureStream() + MediaRecorder.
 *
 * The canvas has a fully transparent background, so the exported WebM can be
 * dropped directly on top of the source video in any NLE (Premiere, DaVinci
 * Resolve, CapCut, etc.) without re-encoding the original footage.
 *
 * Best results in Chrome (VP9 alpha support). Falls back to VP8 / plain WebM.
 */
export default function OverlayExporter({ events, currentMs, minTime, exporting, onDone }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Mutable refs so the stable animation loop always sees fresh prop values
  const propsRef = useRef({ events, currentMs, minTime });
  const onDoneRef = useRef(onDone);

  // Keep refs current after every render without writing during render
  useEffect(() => {
    propsRef.current = { events, currentMs, minTime };
    onDoneRef.current = onDone;
  }, [events, currentMs, minTime, onDone]);

  /**
   * Stable animation loop — no React deps; reads live values via propsRef.
   * Recreating this function on every render would restart MediaRecorder,
   * so it intentionally has an empty dependency array.
   */
  const startLoop = useCallback(() => {
    function tick() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { events: evts, currentMs: cms, minTime: mt } = propsRef.current;
      const ctx = canvas.getContext('2d');
      const W = CANVAS_WIDTH;
      const H = CANVAS_HEIGHT;
      const nowMs = cms + mt; // absolute playback position in ms

      // Transparent background — the key to producing an alpha-channel overlay
      ctx.clearRect(0, 0, W, H);

      // ── Chat messages (bottom-left, no background) ──────────────────────
      const pad = 24;
      const fontSize = 28;
      const smallFont = fontSize - 5;
      const lineH = 44;
      const maxChatW = 500; // max text width in px

      const visible = evts.filter((e) => e.timestamp <= nowMs);
      const maxRows = Math.floor((H * 0.6) / lineH);
      const recent = visible.slice(-maxRows);

      recent.forEach((e, i) => {
        // Anchor messages to the bottom, newest at the bottom
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
          // Name in purple
          ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = '#b98bff';
          const clampedNameW = Math.min(
            ctx.measureText(e.displayName).width,
            maxChatW - 60
          );
          ctx.fillText(e.displayName, pad, y, maxChatW - 60);

          // Colon separator
          ctx.fillStyle = '#ffffff';
          ctx.fillText(':', pad + clampedNameW + 4, y);

          // Emoji — slightly larger
          ctx.font = `${fontSize + 6}px serif`;
          ctx.fillText(e.emoji, pad + clampedNameW + 4 + ctx.measureText(':').width + 10, y);
        }

        ctx.restore();
      });

      // ── Floating emoji reactions ─────────────────────────────────────────
      ctx.font = `${54}px serif`;

      evts.forEach((e) => {
        if (e.type !== 'reaction') return;
        if (e.timestamp > nowMs) return;

        const elapsed = nowMs - e.timestamp;
        if (elapsed > REACTION_LIFETIME) return;

        const progress = elapsed / REACTION_LIFETIME; // 0 → 1
        const eased = 1 - (1 - progress) ** 2; // ease-out quad
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

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []); // stable — all data read via refs, never needs recreating

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (exporting) {
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] });
        onDoneRef.current(blob);
        chunksRef.current = [];
      };

      recorderRef.current = recorder;
      recorder.start(250);
      startLoop();
    } else {
      stopLoop();
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
    }

    return () => {
      stopLoop();
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
    };
  }, [exporting, startLoop, stopLoop]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Visible only during export so the user can see what's being recorded
        display: exporting ? 'block' : 'none',
      }}
    />
  );
}

OverlayExporter.propTypes = {
  events: PropTypes.array.isRequired,
  currentMs: PropTypes.number.isRequired,
  minTime: PropTypes.number.isRequired,
  exporting: PropTypes.bool.isRequired,
  onDone: PropTypes.func.isRequired,
};
