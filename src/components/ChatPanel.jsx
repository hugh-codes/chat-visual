import { useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './ChatPanel.css';

/**
 * Twitch-style scrolling chat panel.
 * Shows join events and reaction events in chronological order.
 */
export default function ChatPanel({ events, currentMs, minTime }) {
  const listRef = useRef(null);

  const visible = events.filter((e) => e.timestamp <= currentMs + minTime);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visible.length]);

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__dot" />
        LIVE CHAT
      </div>
      <div className="chat-panel__messages" ref={listRef}>
        {visible.map((e) =>
          e.type === 'join' ? (
            <div key={e.id} className="chat-message chat-message--join">
              <span className="chat-message__badge join-badge">JOIN</span>
              <span className="chat-message__name">{e.displayName}</span>
              <span className="chat-message__text"> joined the stream</span>
            </div>
          ) : (
            <div key={e.id} className="chat-message chat-message--reaction">
              <span className="chat-message__name">{e.displayName}</span>
              <span className="chat-message__colon">:</span>
              <span className="chat-message__emoji">{e.emoji}</span>
            </div>
          )
        )}
        {visible.length === 0 && (
          <p className="chat-panel__empty">Waiting for messages…</p>
        )}
      </div>
    </div>
  );
}

ChatPanel.propTypes = {
  events: PropTypes.array.isRequired,
  currentMs: PropTypes.number.isRequired,
  minTime: PropTypes.number.isRequired,
};
