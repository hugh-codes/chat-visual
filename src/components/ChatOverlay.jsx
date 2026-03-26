import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { REACTION_LIFETIME } from '../utils/overlayConstants';
import './ChatOverlay.css';

/**
 * Single transparent overlay that combines:
 *  - Floating emoji reactions (float-up animation)
 *  - Transparent chat message list (bottom-left, text-shadow only, no background)
 */
export default function ChatOverlay({ events, currentMs, minTime }) {
  const [activeReactions, setActiveReactions] = useState([]);
  const seenRef = useRef(new Set());
  const prevMsRef = useRef(currentMs);

  // Spawn new floating emoji as playback time advances
  useEffect(() => {
    const now = currentMs + minTime;
    const newOnes = events.filter(
      (e) =>
        e.type === 'reaction' &&
        e.timestamp != null &&
        e.timestamp <= now &&
        !seenRef.current.has(e.id)
    );

    if (newOnes.length === 0) return;

    newOnes.forEach((e) => seenRef.current.add(e.id));

    const spawned = newOnes.map((e) => ({
      key: `${e.id}-${Date.now()}`,
      emoji: e.emoji,
      left: 10 + Math.random() * 80,
      born: Date.now(),
    }));

    setActiveReactions((prev) => [...prev, ...spawned]);

    const timer = setTimeout(() => {
      const cutoff = Date.now() - REACTION_LIFETIME;
      setActiveReactions((prev) => prev.filter((r) => r.born >= cutoff));
    }, REACTION_LIFETIME + 100);

    return () => clearTimeout(timer);
  }, [currentMs, events, minTime]);

  // Clear state when playback rewinds
  useEffect(() => {
    const didRewind = currentMs < prevMsRef.current - 1000;
    prevMsRef.current = currentMs;
    if (didRewind) {
      seenRef.current.clear();
      const t = setTimeout(() => setActiveReactions([]), 0);
      return () => clearTimeout(t);
    }
  }, [currentMs]);

  const visible = events
    .filter((e) => e.timestamp != null && e.timestamp <= currentMs + minTime)
    .slice(-12); // last 12 events

  return (
    <div className="chat-overlay">
      {/* Floating emoji reactions */}
      {activeReactions.map((r) => (
        <span
          key={r.key}
          className="chat-overlay__emoji"
          style={{ left: `${r.left}%` }}
        >
          {r.emoji}
        </span>
      ))}

      {/* Transparent message list — bottom-left */}
      <div className="chat-overlay__messages">
        {visible.map((e) =>
          e.type === 'join' ? (
            <div key={e.id} className="chat-overlay__msg chat-overlay__msg--join">
              <span className="chat-overlay__name">{e.displayName}</span>
              {' joined'}
            </div>
          ) : (
            <div key={e.id} className="chat-overlay__msg">
              <span className="chat-overlay__name">{e.displayName}</span>
              <span className="chat-overlay__colon">:</span>
              <span className="chat-overlay__msg-emoji">{e.emoji}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

ChatOverlay.propTypes = {
  events: PropTypes.array.isRequired,
  currentMs: PropTypes.number.isRequired,
  minTime: PropTypes.number.isRequired,
};
