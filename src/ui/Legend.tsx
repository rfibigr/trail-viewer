import { cssScaleGradient, scalePosition, type Theme } from './colors';
import { formatInt } from './format';

/** Tick values in m/h, spaced so labels never collide down to phone width. */
const TICKS: { v: number }[] = [{ v: -2500 }, { v: -1000 }, { v: 0 }, { v: 500 }, { v: 1500 }];

export function Legend({ theme }: { theme: Theme }) {
  return (
    <div className="legend" aria-label="Colour legend: vertical speed in metres per hour, descents cool, climbs warm">
      <div className="legend-head">
        <span>◀ Descent</span>
        <span className="legend-title">Vertical speed, m/h</span>
        <span>Climb ▶</span>
      </div>
      <div className="legend-bar" style={{ background: cssScaleGradient(theme) }}>
        <i className="legend-zero" style={{ left: `${scalePosition(0) * 100}%` }} />
      </div>
      <div className="legend-ticks">
        {TICKS.map(({ v }, i) => (
          <span
            key={v}
            style={{ left: `${scalePosition(v) * 100}%` }}
            data-edge={i === 0 ? 'start' : i === TICKS.length - 1 ? 'end' : undefined}
          >
            {i === 0 ? '≤' : ''}
            {v > 0 ? '+' : ''}
            {formatInt(v)}
            {i === TICKS.length - 1 ? '+' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
