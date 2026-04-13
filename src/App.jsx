import { useState, useEffect, useRef, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import ChatOverlay from './components/ChatOverlay';
import OverlayExporter from './components/OverlayExporter';
import Timeline from './components/Timeline';
import { parseJsonl, getTimeRange } from './utils/parseJsonl';
import './App.css';

const TICK_MS = 100; // playback tick resolution in milliseconds

export default function App() {
  const [events, setEvents] = useState(null);        // null = not loaded yet
  const [minTime, setMinTime] = useState(0);         // first event timestamp (ms)
  const [duration, setDuration] = useState(0);       // total stream duration (seconds)
  const [currentTime, setCurrentTime] = useState(0); // playback position (seconds)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [filename, setFilename] = useState('');
  const [videoSrc, setVideoSrc] = useState(null);    // object URL for the loaded video
  const [videoFile, setVideoFile] = useState(null);  // File object for composite export
  const [exporting, setExporting] = useState(false); // true while recording overlay MP4
  const [exportProgress, setExportProgress] = useState(null); // null | 0-1 | { error }
  const [exportError, setExportError] = useState(null);
  const intervalRef = useRef(null);
  const videoRef = useRef(null);
  const videoInputRef = useRef(null);

  // Parse JSONL text and initialise playback state
  const handleLoad = useCallback((text, name = '') => {
    const parsed = parseJsonl(text);
    const [min, max] = getTimeRange(parsed);
    const dur = (max - min) / 1000;
    setEvents(parsed);
    setMinTime(min);
    setDuration(dur);
    setCurrentTime(0);
    setPlaying(false);
    setFilename(name);
  }, []);

  // Load a video file using createObjectURL so large files are streamed from
  // disk rather than read entirely into memory.
  const handleVideoFile = useCallback((file) => {
    if (!file || !file.type.startsWith('video/')) return;
    setCurrentTime(0);
    setPlaying(false);
    setVideoFile(file);
    setVideoSrc(URL.createObjectURL(file));
  }, []);

  // Revoke the object URL when it changes or the component unmounts to avoid
  // memory leaks.
  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  // Download the overlay blob when encoding finishes
  const handleExportDone = useCallback((blob) => {
    setExporting(false);
    setExportProgress(null);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // When a source video was composited, produce a self-contained output file;
    // otherwise label it as an overlay for use in an NLE.
    a.download = videoFile ? 'chatvisual-export.mp4' : 'chatvisual-overlay.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [videoFile]);

  const handleExportProgress = useCallback((value) => {
    if (value && value.error) {
      setExportError(value.error);
      setExporting(false);
      setExportProgress(null);
    } else {
      setExportProgress(value);
    }
  }, []);

  const handleExportToggle = () => {
    if (exporting) {
      setExporting(false);
      setExportProgress(null);
    } else {
      setExportError(null);
      setExportProgress(0);
      setExporting(true);
    }
  };

  // Playback ticker — only used when no video is loaded (video drives its own
  // timeupdate events instead).
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (!playing || videoSrc) return;

    intervalRef.current = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + (TICK_MS / 1000) * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, TICK_MS);

    return () => clearInterval(intervalRef.current);
  }, [playing, speed, duration, videoSrc]);

  // Sync play/pause state with the video element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  // Sync playback speed with the video element.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Stable callback for natural playback end (video ended or ticker reached duration)
  const handlePlaybackEnd = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleSeek = (val) => {
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  const handleTogglePlay = () => {
    if (currentTime >= duration) {
      setCurrentTime(0);
      if (videoRef.current) videoRef.current.currentTime = 0;
    }
    setPlaying((p) => !p);
  };

  const handleStreamDragOver = (e) => e.preventDefault();
  const handleStreamDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    handleVideoFile(file);
  };

  const currentMs = currentTime * 1000; // convert to ms for event comparisons

  const reactionCount = events
    ? events.filter(
        (e) => e.type === 'reaction' && e.timestamp <= currentMs + minTime
      ).length
    : 0;

  if (!events) {
    return <FileUpload onLoad={(text, name) => handleLoad(text, name)} />;
  }

  return (
    <div className="app">
      {/* Top bar */}
      <header className="app__topbar">
        <span className="app__logo">
          <span className="app__logo-purple">chat</span>visual
        </span>
        {filename && <span className="app__filename">{filename}</span>}
        <div className="app__stats">
          <span className="app__stat">
            <span className="app__stat-label">Events</span>
            <span className="app__stat-value">{events.length}</span>
          </span>
          <span className="app__stat">
            <span className="app__stat-label">Reactions shown</span>
            <span className="app__stat-value">{reactionCount}</span>
          </span>
        </div>
        {/* Video file picker button */}
        <button
          className="app__video-btn"
          onClick={() => videoInputRef.current?.click()}
          title={videoSrc ? 'Replace video file' : 'Load video file'}
        >
          🎬 {videoSrc ? 'Replace video' : 'Add video'}
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => handleVideoFile(e.target.files?.[0])}
        />
        {/* Export overlay button */}
        <button
          className={`app__export-btn${exporting ? ' app__export-btn--active' : ''}`}
          onClick={handleExportToggle}
          title={
            exporting
              ? 'Cancel export'
              : videoFile
                ? 'Export final MP4 with video, chat overlay, and audio'
                : 'Export chat overlay as MP4 (no need to play the video)'
          }
        >
          {exporting ? '⏹ Cancel Export' : '⬇ Export MP4'}
        </button>
        <button
          className="app__reset-btn"
          onClick={() => {
            setEvents(null);
            setPlaying(false);
            setExporting(false);
            setExportProgress(null);
            setExportError(null);
            setVideoSrc(null);
            setVideoFile(null);
          }}
        >
          Load new file
        </button>
      </header>

      {/* Main area */}
      <div className="app__main">
        <div className="app__stream">
          {/* Stream / video area — accepts video drag-and-drop */}
          <div
            className="app__stream-bg"
            onDragOver={handleStreamDragOver}
            onDrop={handleStreamDrop}
          >
            {videoSrc ? (
              <video
                ref={videoRef}
                className="app__video"
                src={videoSrc}
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    setCurrentTime(videoRef.current.currentTime);
                  }
                }}
                onEnded={handlePlaybackEnd}
              />
            ) : (
              <div
                className="app__stream-placeholder app__stream-placeholder--clickable"
                onClick={() => videoInputRef.current?.click()}
              >
                <span className="app__stream-icon">🎬</span>
                <p>Drop a video file here</p>
                <p className="app__stream-hint">
                  or click to browse · MP4, MOV, MKV &amp; more · large files supported
                </p>
              </div>
            )}

            {/* Transparent overlay: floating reactions + chat messages */}
            <ChatOverlay
              events={events}
              currentMs={currentMs}
              minTime={minTime}
            />
            {/* Canvas encoder — off-screen; self-drives time, no playback needed */}
            <OverlayExporter
              events={events}
              minTime={minTime}
              duration={duration}
              exporting={exporting}
              onProgress={handleExportProgress}
              onDone={handleExportDone}
              videoFile={videoFile}
            />

            {/* Export progress overlay */}
            {exporting && exportProgress !== null && (
              <div className="app__export-progress">
                <div className="app__export-progress-bar">
                  <div
                    className="app__export-progress-fill"
                    style={{ width: `${Math.round(exportProgress * 100)}%` }}
                  />
                </div>
                <span className="app__export-progress-label">
                  Encoding MP4… {Math.round(exportProgress * 100)}%
                </span>
                <span className="app__export-progress-hint">
                  {videoFile
                    ? 'Encoding final video with chat overlay and audio…'
                    : 'Use \u201cScreen\u201d blend mode in your video editor to composite'}
                </span>
              </div>
            )}

            {/* Export error banner */}
            {exportError && (
              <div className="app__export-error">
                ⚠ {exportError}
                <button
                  className="app__export-error-dismiss"
                  onClick={() => setExportError(null)}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <Timeline
            duration={duration}
            currentTime={currentTime}
            playing={playing}
            onSeek={handleSeek}
            onTogglePlay={handleTogglePlay}
            speed={speed}
            onSpeedChange={setSpeed}
          />
        </div>
      </div>
    </div>
  );
}
