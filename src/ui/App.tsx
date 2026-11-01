import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions, type AnalysisResult } from '../types';
import { ElevationChart } from './ElevationChart';
import { Legend } from './Legend';
import { errorMessage, loadDemo, loadFitFile, loadMock, type Source } from './pipeline';
import type { ColorMode, XMode } from './profile';
import { SegmentTable } from './SegmentTable';
import { SettingsPanel } from './SettingsPanel';
import { SummaryBar } from './SummaryBar';
import { UploadPanel } from './UploadPanel';
import { useTheme } from './useTheme';
import './styles.css';

const DEV = import.meta.env.DEV;

type Analysis = { result: AnalysisResult; error: null } | { result: AnalysisResult | null; error: string };

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
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  const [xMode, setXMode] = useState<XMode>('distance');
  const [colorMode, setColorMode] = useState<ColorMode>('segment');
  const [tableHover, setTableHover] = useState<number | null>(null);
  const [chartHover, setChartHover] = useState<number | null>(null);

  const deferredOptions = useDeferredValue(options);
  const lastGood = useRef<AnalysisResult | null>(null);

  const analysis = useMemo<Analysis | null>(() => {
    if (!source) return null;
    try {
      const result = source.analyze(deferredOptions);
      lastGood.current = result;
      return { result, error: null };
    } catch (e) {
      return { result: lastGood.current, error: errorMessage(e) };
    }
  }, [source, deferredOptions]);

  const open = useCallback(
    async (load: () => Promise<Source>) => {
      setLoading(true);
      setLoadError(null);
      try {
        const src = await load();
        const first = src.analyze(options); // fail on the upload screen, not in an empty viewer
        lastGood.current = first;
        setTableHover(null);
        setChartHover(null);
        setSource(src);
      } catch (e) {
        setLoadError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  // ?mock in the URL (dev only) jumps straight to the mock result, handy for screenshots.
  useEffect(() => {
    if (DEV && new URLSearchParams(location.search).has('mock')) void open(loadMock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = analysis?.result ?? null;

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSource(null)}>
              Open file
            </button>
          </>
        )}
      </header>

      {!source || !result ? (
        <UploadPanel
          loading={loading}
          error={loadError}
          onFile={(f) => open(() => loadFitFile(f))}
          onDemo={() => open(loadDemo)}
          onMock={DEV ? () => open(loadMock) : undefined}
        />
      ) : (
        <main className="viewer">
          {analysis?.error && (
            <div className="error" role="alert">
              <strong>Analysis failed with these settings.</strong>
              <span>{analysis.error} — showing the last successful result.</span>
            </div>
          )}
          <SummaryBar summary={result.summary} />
          <div className="layout">
            <section className={`card chart-card${options !== deferredOptions ? ' stale' : ''}`} aria-labelledby="chart-title">
              <div className="card-head chart-head">
                <h2 id="chart-title">Elevation profile</h2>
                <div className="chart-controls">
                  <Toggle label="X axis" value={xMode} onChange={setXMode} options={[['distance', 'Distance'], ['time', 'Moving time']]} />
                  <Toggle label="Colour" value={colorMode} onChange={setColorMode} options={[['segment', 'Segment avg'], ['point', 'Rolling']]} />
                </div>
              </div>
              <ElevationChart
                result={result}
                xMode={xMode}
                colorMode={colorMode}
                theme={theme}
                highlightSegment={tableHover ?? chartHover}
                onHoverSegment={setChartHover}
              />
              <Legend theme={theme} />
            </section>
            <SettingsPanel options={options} onChange={setOptions} />
          </div>
          <SegmentTable segments={result.segments} theme={theme} activeIndex={tableHover ?? chartHover} onHover={setTableHover} />
        </main>
      )}
    </div>
  );
}
