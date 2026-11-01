import { verticalSpeedColor, type Theme } from './colors';
import { formatDuration, formatElevation, formatGrade, formatKm, formatVerticalSpeed } from './format';
import type { RangeStats } from './rangeStats';

interface Props {
  stats: RangeStats | null;
  theme: Theme;
  onClear: () => void;
}

/** Stats for the drag-selected range, or a hint when nothing is selected. Fixed height to avoid layout jumps. */
export function RangeStatsBar({ stats, theme, onClear }: Props) {
  if (!stats) {
    return (
      <div className="range range-empty">
        <span className="range-hint">Drag across the graphs to measure any stretch</span>
      </div>
    );
  }
  return (
    <div className="range" role="status" aria-live="polite">
      <div className="range-item range-where">
        <span className="range-label">Selection</span>
        <b>
          {(stats.startDistance / 1000).toFixed(2)}–{formatKm(stats.endDistance)}
        </b>
        <span className="muted">{formatKm(stats.distance)}</span>
      </div>
      <div className="range-item range-key">
        <span className="range-label">Avg vert. speed</span>
        <b>
          <i className="swatch" style={{ background: verticalSpeedColor(stats.avgVerticalSpeed, theme) }} />
          {formatVerticalSpeed(stats.avgVerticalSpeed)}
        </b>
      </div>
      <div className="range-item">
        <span className="range-label">Grade</span>
        <b>{formatGrade(stats.avgGrade)}</b>
      </div>
      <div className="range-item">
        <span className="range-label">Moving time</span>
        <b>{formatDuration(stats.movingTime)}</b>
      </div>
      <div className="range-item">
        <span className="range-label">D+ / D−</span>
        <b>
          {formatElevation(stats.gain)} / {formatElevation(stats.loss)}
        </b>
      </div>
      <button type="button" className="range-close" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
        ×
      </button>
    </div>
  );
}
