import { CLIMB_STOPS, DESCENT_STOPS, FLAT_COLOR, cssGradient, type ColorStop, type Theme } from './colors';
import { formatInt } from './format';

interface ScaleProps {
  label: string;
  stops: readonly ColorStop[];
  ticks: number[];
}

function Scale({ label, stops, ticks }: ScaleProps) {
  const max = Math.abs(stops[stops.length - 1].value);
  return (
    <div className="legend-scale">
      <div className="legend-label">{label}</div>
      <div className="legend-bar" style={{ background: cssGradient(stops, 'to right', 16) }} />
      <div className="legend-ticks">
        {ticks.map((v, i) => (
          <span key={v} style={{ left: `${(Math.abs(v) / max) * 100}%` }} data-edge={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : undefined}>
            {v > 0 ? '+' : ''}
            {formatInt(v)}
            {i === ticks.length - 1 ? '+' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Legend({ theme }: { theme: Theme }) {
  return (
    <div className="legend" aria-label="Colour legend: vertical speed in metres per hour">
      <Scale label="Climb, m/h" stops={CLIMB_STOPS} ticks={[0, 500, 1000, 1500]} />
      <Scale label="Descent, m/h" stops={DESCENT_STOPS} ticks={[0, -1000, -2500]} />
      <div className="legend-flat">
        <span className="legend-swatch" style={{ background: FLAT_COLOR[theme] }} />
        Flat
      </div>
    </div>
  );
}
