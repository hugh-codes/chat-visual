import { useState, useEffect, useRef, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import ChatPanel from './components/ChatPanel';
import ReactionOverlay from './components/ReactionOverlay';
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
  const intervalRef = useRef(null);

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

  // Playback ticker
  useEffect(() => {
    if (!playing) {
      clearInterval(intervalRef.current);
      return;
    }
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
  }, [playing, speed, duration]);

  const handleSeek = (val) => {
    setCurrentTime(val);
  };

  const handleTogglePlay = () => {
    if (currentTime >= duration) {
      setCurrentTime(0);
    }
    setPlaying((p) => !p);
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
        <button
          className="app__reset-btn"
          onClick={() => {
            setEvents(null);
            setPlaying(false);
          }}
        >
          Load new file
        </button>
      </header>

      {/* Main area */}
      <div className="app__main">
        {/* Stream area */}
        <div className="app__stream">
          <div className="app__stream-bg">
            <div className="app__stream-placeholder">
              <span className="app__stream-icon">📺</span>
              <p>Video placeholder</p>
              <p className="app__stream-hint">
                Drop your video here or integrate a player
              </p>
            </div>
            <ReactionOverlay
              events={events}
              currentTime={currentTime}
              minTime={minTime}
            />
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

        {/* Chat panel */}
        <ChatPanel
          events={events}
          currentTime={currentMs}
          minTime={minTime}
        />
      </div>
    </div>
  );
}
