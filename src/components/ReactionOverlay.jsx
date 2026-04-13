import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './ReactionOverlay.css';

const REACTION_LIFETIME = 3000; // ms a reaction floats on screen

/**
 * Displays emoji reactions floating up from the bottom of the stream area.
 * A reaction is shown when its timestamp first enters the current playback window.
 */
export default function ReactionOverlay({ events, currentMs, minTime }) {
  const [active, setActive] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    const now = currentMs + minTime;
    const newOnes = events.filter(
      (e) =>
        e.type === 'reaction' &&
        e.timestamp <= now &&
        !seenRef.current.has(e.id)
    );

    if (newOnes.length === 0) return;

    newOnes.forEach((e) => seenRef.current.add(e.id));

    const spawned = newOnes.map((e) => ({
      key: `${e.id}-${Date.now()}`,
      emoji: e.emoji,
      left: 10 + Math.random() * 80, // % from left
      born: Date.now(),
    }));

    setActive((prev) => [...prev, ...spawned]);

    const timer = setTimeout(() => {
      const cutoff = Date.now() - REACTION_LIFETIME;
      setActive((prev) => prev.filter((r) => r.born >= cutoff));
    }, REACTION_LIFETIME + 100);

    return () => clearTimeout(timer);
  }, [currentMs, events, minTime]);

  // Reset seen set when playback rewinds
  const lastMsRef = useRef(currentMs);

  useEffect(() => {
    const didRewind = currentMs < lastMsRef.current - 1000;
    lastMsRef.current = currentMs;
    if (didRewind) {
      seenRef.current.clear();
      const t = setTimeout(() => setActive([]), 0);
      return () => clearTimeout(t);
    }
  }, [currentMs]);

  return (
    <div className="reaction-overlay">
      {active.map((r) => (
        <span
          key={r.key}
          className="reaction-overlay__emoji"
          style={{ left: `${r.left}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

ReactionOverlay.propTypes = {
  events: PropTypes.array.isRequired,
  currentMs: PropTypes.number.isRequired,
  minTime: PropTypes.number.isRequired,
};
