import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/**
 * OverlayExporter — exports the chat+reaction overlay as a 1920×1080 MP4
 * without requiring the video to play in real-time.
 *
 * The entire encode loop runs in a Web Worker (exportWorker.js) on an
 * OffscreenCanvas so the UI thread stays fully responsive throughout. Mediabunny's
 * CanvasSource handles WebCodecs VideoEncoder management and backpressure
 * automatically, removing the manual polling loop from the old implementation.
 *
 * Typical speed: 10–50× faster than real-time.
 * Output: MP4 with black background — use "Screen" blend mode in your NLE.
 */
export default function OverlayExporter({ events, minTime, duration, exporting, onProgress, onDone, videoFile }) {
  const workerRef = useRef(null);

  useEffect(() => {
    if (!exporting) {
      // Terminate any running worker when the user cancels
      workerRef.current?.terminate();
      workerRef.current = null;
      return;
    }

    if (typeof OffscreenCanvas === 'undefined') {
      onProgress({ error: 'OffscreenCanvas is not available in this browser. Please use Chrome 94+ or Edge 94+.' });
      return;
    }

    const canvas = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const worker = new Worker(
      new URL('../workers/exportWorker.js', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress(data.value);
      } else if (data.type === 'done') {
        workerRef.current = null;
        onDone(new Blob([data.buffer], { type: 'video/mp4' }));
      } else if (data.type === 'error') {
        workerRef.current = null;
        onProgress({ error: data.error });
      }
    };

    worker.onerror = (e) => {
      workerRef.current = null;
      onProgress({ error: e.message ?? 'Unknown export error' });
    };

    // Transfer the OffscreenCanvas to the worker (zero-copy ownership transfer)
    worker.postMessage({ canvas, events, minTime, duration, videoFile: videoFile ?? null }, [canvas]);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [exporting, events, minTime, duration, onProgress, onDone, videoFile]);

  // No DOM canvas needed — the worker owns an OffscreenCanvas
  return null;
}

OverlayExporter.propTypes = {
  events: PropTypes.array.isRequired,
  minTime: PropTypes.number.isRequired,
  duration: PropTypes.number.isRequired, // seconds
  exporting: PropTypes.bool.isRequired,
  onProgress: PropTypes.func.isRequired, // (0-1 | { error: string }) => void
  onDone: PropTypes.func.isRequired,     // (Blob) => void
  videoFile: PropTypes.instanceOf(File),    // File | null — present for full composite export
};

