import PropTypes from 'prop-types';
import './FileUpload.css';

/**
 * Drag-and-drop or click-to-browse file upload for a JSONL file.
 * Also provides a button to load the bundled example file.
 */
export default function FileUpload({ onLoad }) {
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => onLoad(e.target.result, file.name);
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleChange = (e) => {
    handleFile(e.target.files?.[0]);
  };

  const handleLoadExample = async () => {
    try {
      const res = await fetch('/examplejsonl.jsonl');
      const text = await res.text();
      onLoad(text, 'examplejsonl.jsonl');
    } catch {
      alert('Could not load example file.');
    }
  };

  return (
    <div className="file-upload">
      <div className="file-upload__hero">
        <h1 className="file-upload__title">
          <span className="file-upload__purple">chat</span>visual
        </h1>
        <p className="file-upload__subtitle">
          Replay live-stream chat &amp; reactions from a JSONL export
        </p>
      </div>

      <label
        className="file-upload__dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".jsonl,.json"
          className="file-upload__input"
          onChange={handleChange}
        />
        <span className="file-upload__icon">📂</span>
        <span className="file-upload__label">
          Drop a <code>.jsonl</code> file here, or{' '}
          <span className="file-upload__link">click to browse</span>
        </span>
      </label>

      <p className="file-upload__or">— or —</p>

      <button className="file-upload__example-btn" onClick={handleLoadExample}>
        Load example file
      </button>
    </div>
  );
}

FileUpload.propTypes = {
  onLoad: PropTypes.func.isRequired,
};
