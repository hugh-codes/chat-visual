import PropTypes from 'prop-types';
import './Timeline.css';

/**
 * Playback controls: play/pause button, a scrubber range input, and a time
 * readout.  All time values are in seconds relative to the start of the stream.
 */
export default function Timeline({
  duration,
  currentTime,
  playing,
  onSeek,
  onTogglePlay,
  speed,
  onSpeedChange,
}) {
  const fmt = (s) => {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const sec = Math.floor(s % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <div className="timeline">
      <button
        className={`timeline__btn${playing ? ' timeline__btn--pause' : ''}`}
        onClick={onTogglePlay}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <span className="timeline__time">{fmt(currentTime)}</span>

      <input
        className="timeline__scrubber"
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={currentTime}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
      />

      <span className="timeline__time">{fmt(duration)}</span>

      <select
        className="timeline__speed"
        value={speed}
        onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
        title="Playback speed"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
    </div>
  );
}

Timeline.propTypes = {
  duration: PropTypes.number.isRequired,
  currentTime: PropTypes.number.isRequired,
  playing: PropTypes.bool.isRequired,
  onSeek: PropTypes.func.isRequired,
  onTogglePlay: PropTypes.func.isRequired,
  speed: PropTypes.number.isRequired,
  onSpeedChange: PropTypes.func.isRequired,
};
