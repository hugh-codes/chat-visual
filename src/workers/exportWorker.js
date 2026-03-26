/**
 * Web Worker: off-screen H.264/MP4 export.
 *
 * Runs the entire encode loop on a worker thread so the UI stays responsive
 * and the encoder gets the full CPU budget. The main thread creates an
 * OffscreenCanvas, transfers it here, then receives progress / done / error
 * messages back.
 *
 * Expected inbound message (only one, to start the job):
 *   { canvas: OffscreenCanvas, events: Array, minTime: number, duration: number,
 *     videoFile?: File }
 *   The canvas is transferred (zero-copy) via the transferable list.
 *   videoFile is optional — when present, the worker composites the source video
 *   behind the overlay and transmuxes the audio, producing a fully self-contained
 *   output MP4. When absent, the output is overlay-only (black background).
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
  Input,
  BlobSource,
  ALL_FORMATS,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  VideoSampleSink,
} from 'mediabunny';
import { REACTION_LIFETIME, reactionLeft } from '../utils/overlayConstants';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const EXPORT_FPS = 30;
const FRAME_DURATION = 1 / EXPORT_FPS; // seconds

// ── Draw the chat overlay onto whatever is already on the canvas ──────────────
// Does NOT fill the background — call this after painting the video frame (or a
// black fill) so the overlay sits on top.
function drawOverlay(ctx, events, minTime, offsetMs) {
  const W = CANVAS_WIDTH;
  const H = CANVAS_HEIGHT;
  const nowMs = offsetMs + minTime;

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

// ── Draw black background + overlay (overlay-only export path) ────────────────
function drawFrame(ctx, events, minTime, offsetMs) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawOverlay(ctx, events, minTime, offsetMs);
}

// ── Audio transmux: copy encoded audio packets from source → output ───────────
// No decode/re-encode — just bytes. Nearly instantaneous.
//
// @param {InputAudioTrack} audioTrack - The audio track from the source Input.
// @param {EncodedAudioPacketSource} audioSource - The output audio source to feed.
// @param {number} durationS - The overlay duration in seconds; packets beyond this
//   are discarded to keep audio and video in sync.
async function transmuxAudio(audioTrack, audioSource, durationS) {
  const decoderConfig = await audioTrack.getDecoderConfig();
  const sink = new EncodedPacketSink(audioTrack);
  let isFirst = true;

  for await (const packet of sink.packets()) {
    // Do not include audio beyond the overlay duration (keeps A/V in sync)
    if (packet.timestamp >= durationS) break;

    const meta = isFirst && decoderConfig ? { decoderConfig } : undefined;
    await audioSource.add(packet, meta);
    isFirst = false;
  }

  audioSource.close();
}

// ── Main encode loop ──────────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
  const { canvas, events, minTime, duration, videoFile } = data;

  // Open the source video file (if provided) to extract the video + audio tracks.
  let input = null;
  let srcVideoTrack = null;
  let srcAudioTrack = null;

  if (videoFile) {
    try {
      input = new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS });
      [srcVideoTrack, srcAudioTrack] = await Promise.all([
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
      ]);
    } catch {
      // Could not open or parse the file — fall back to overlay-only export.
      input?.dispose();
      input = null;
      srcVideoTrack = null;
      srcAudioTrack = null;
    }
  }

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

    // Add an audio track when we have a source audio stream to transmux.
    let audioSource = null;
    if (srcAudioTrack?.codec) {
      audioSource = new EncodedAudioPacketSource(srcAudioTrack.codec);
      output.addAudioTrack(audioSource);
    }

    await output.start();

    // Kick off audio transmux concurrently — the output muxer interleaves the
    // audio and video packets automatically.
    const audioPromise = audioSource
      ? transmuxAudio(srcAudioTrack, audioSource, duration).catch(() => {
          // Audio transmux failure is non-fatal; output will simply have no audio.
        })
      : Promise.resolve();

    if (srcVideoTrack) {
      // ── Composite mode: source video behind, overlay on top ───────────────
      // samplesAtTimestamps requests one decoded frame per output timestamp.
      // It uses a pipelined decoder and never decodes the same source frame
      // twice, so it is as fast as the hardware decoder allows.
      const frameSink = new VideoSampleSink(srcVideoTrack);
      const timestamps = Array.from({ length: totalFrames }, (_, i) => i * FRAME_DURATION);

      let i = 0;
      for await (const sample of frameSink.samplesAtTimestamps(timestamps)) {
        const offsetMs = i * FRAME_DURATION * 1000;

        if (sample) {
          // Scale source frame to fill the canvas, then overlay chat on top.
          sample.draw(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          sample.close();
        } else {
          // No source frame available (e.g. past end of video) — use black.
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
        drawOverlay(ctx, events, minTime, offsetMs);

        // Awaiting add() automatically respects encoder + muxer backpressure
        // without any setTimeout polling.
        await videoSource.add(i * FRAME_DURATION, FRAME_DURATION, {
          // A key frame every 150 frames (5 s at 30 fps) balances seekability
          // against file size — shorter streams need a key frame near the start.
          keyFrame: i % 150 === 0,
        });

        // Post progress once per second of encoded content
        if (i % EXPORT_FPS === 0) {
          self.postMessage({ type: 'progress', value: i / totalFrames });
        }

        i++;
      }
    } else {
      // ── Overlay-only mode (no source video) ───────────────────────────────
      for (let i = 0; i < totalFrames; i++) {
        const offsetMs = (i / EXPORT_FPS) * 1000;
        drawFrame(ctx, events, minTime, offsetMs);

        await videoSource.add(i * FRAME_DURATION, FRAME_DURATION, {
          keyFrame: i % 150 === 0,
        });

        if (i % EXPORT_FPS === 0) {
          self.postMessage({ type: 'progress', value: i / totalFrames });
        }
      }
    }

    videoSource.close();
    await audioPromise;
    await output.finalize();
    input?.dispose();

    // Transfer the ArrayBuffer zero-copy back to the main thread
    const buffer = output.target.buffer;
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    input?.dispose();
    self.postMessage({ type: 'error', error: String(err) });
  }
};
