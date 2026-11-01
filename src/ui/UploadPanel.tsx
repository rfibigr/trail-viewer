import { useRef, useState, type DragEvent } from 'react';

/** iOS greys out files whose type it can't map from `accept`, so touch devices get no filter (validated after picking). */
const ACCEPT =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? undefined
    : '.fit,.zip,application/zip,application/x-zip-compressed,application/vnd.ant.fit';

interface Props {
  loading: boolean;
  error: string | null;
  onFile: (file: File) => void;
  onDemo: () => void;
  /** Dev-only extra action (mock data). */
  onMock?: () => void;
}

export function UploadPanel({ loading, error, onFile, onDemo, onMock }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !loading) onFile(file);
  };

  return (
    <main className="upload">
      <div className="upload-intro">
        <h1>
          See every climb.
          <br />
          <span className="grad-text">Own every descent.</span>
        </h1>
        <p>
          Drop the file from Garmin Connect (⚙️ → Export File), .zip or .fit, to get your elevation profile coloured by vertical
          speed. It stays on your device: nothing is uploaded.
        </p>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}${loading ? ' loading' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !loading && input.current?.click()}
        role="button"
        tabIndex={0}
        aria-busy={loading}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !loading) {
            e.preventDefault();
            input.current?.click();
          }
        }}
      >
        {loading ? (
          <>
            <span className="spinner" aria-hidden />
            <strong>Reading activity…</strong>
          </>
        ) : (
          <>
            <svg className="drop-icon" viewBox="0 0 48 48" aria-hidden>
              <path d="M4 38 L16 20 L23 29 L31 14 L44 38 Z" />
            </svg>
            <strong>Drop your activity here</strong>
            <span className="muted">.zip or .fit · or tap to choose a file</span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </div>

      <div className="upload-actions">
        <button type="button" className="btn" onClick={onDemo} disabled={loading}>
          Load demo activity
        </button>
        {onMock && (
          <button type="button" className="btn btn-ghost" onClick={onMock} disabled={loading}>
            Dev: mock analysis
          </button>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <strong>Couldn’t open that activity.</strong>
          <span>{error}</span>
        </div>
      )}
    </main>
  );
}
