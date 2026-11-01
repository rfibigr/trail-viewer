import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisResult } from '../types';
import { ElevationChart, type IndexRange } from './ElevationChart';
import { Legend } from './Legend';
import { errorMessage, loadDemo, loadFitFile, loadMock, type Source } from './pipeline';
import type { XMode } from './profile';
import { rangeStats } from './rangeStats';
import { RangeStatsBar } from './RangeStatsBar';
import { SegmentTable } from './SegmentTable';
import { SummaryBar } from './SummaryBar';
import { UploadPanel } from './UploadPanel';
import { useTheme } from './useTheme';
import './styles.css';

const DEV = import.meta.env.DEV;
/** Dev-only mock button, shown with ?dev so it stays out of screenshots. */
const SHOW_MOCK = DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');

interface Loaded {
  source: Source;
  result: AnalysisResult;
}

function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="toggle" role="radiogroup" aria-label={label}>
      <span className="toggle-label">{label}</span>
      <div className="toggle-btns">
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const theme = useTheme();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [xMode, setXMode] = useState<XMode>('distance');
  const [tableHover, setTableHover] = useState<number | null>(null);
  const [chartHover, setChartHover] = useState<number | null>(null);
  const [selection, setSelection] = useState<IndexRange | null>(null);

  const open = useCallback(async (load: () => Promise<Source>) => {
    setLoading(true);
    setLoadError(null);
    try {
      const source = await load();
      const result = source.analyze(DEFAULT_ANALYSIS_OPTIONS);
      setTableHover(null);
      setChartHover(null);
      setSelection(null);
      setLoaded({ source, result });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ?mock (dev only) jumps straight to the mock result; ?demo loads the demo file. Handy for screenshots.
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current) return; // StrictMode runs effects twice in dev
    autoloaded.current = true;
    const q = new URLSearchParams(location.search);
    if (DEV && q.has('mock')) void open(loadMock);
    else if (q.has('demo')) void open(loadDemo);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelection(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stats = useMemo(
    () => (loaded && selection ? rangeStats(loaded.result.points, selection[0], selection[1]) : null),
    [loaded, selection],
  );

  const source = loaded?.source;
  const result = loaded?.result;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden>
            <path d="M2 26 L11 12 L16 19 L22 8 L30 26 Z" />
          </svg>
          <span>Trail Viewer</span>
        </div>
        {source && (
          <>
            <div className="activity-name" title={source.name}>
              <strong>{source.name}</strong>
              {source.startTime && (
                <span className="muted">
                  {source.startTime.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLoaded(null)}>
              Open file
            </button>
          </>
        )}
      </header>

      {!result ? (
        <UploadPanel
          loading={loading}
          error={loadError}
          onFile={(f) => open(() => loadFitFile(f))}
          onDemo={() => open(loadDemo)}
          onMock={SHOW_MOCK ? () => open(loadMock) : undefined}
        />
      ) : (
        <main className="viewer">
          <SummaryBar summary={result.summary} />
          <section className="card chart-card" aria-labelledby="chart-title">
            <div className="card-head chart-head">
              <h2 id="chart-title">Elevation &amp; vertical speed</h2>
              <Toggle label="X axis" value={xMode} onChange={setXMode} options={[['distance', 'Distance'], ['time', 'Moving time']]} />
            </div>
            <RangeStatsBar stats={stats} theme={theme} onClear={() => setSelection(null)} />
            <ElevationChart
              result={result}
              xMode={xMode}
              theme={theme}
              highlightSegment={tableHover ?? chartHover}
              onHoverSegment={setChartHover}
              selection={selection}
              onSelect={setSelection}
            />
            <Legend theme={theme} />
          </section>
          <SegmentTable segments={result.segments} theme={theme} activeIndex={tableHover ?? chartHover} onHover={setTableHover} />
        </main>
      )}
    </div>
  );
}
