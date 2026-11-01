import { useMemo, useState } from 'react';
import type { Segment } from '../types';
import { segmentColor, type Theme } from './colors';
import { directionLabel, formatDuration, formatElevation, formatGrade, formatKm, formatVerticalSpeed } from './format';

type SortKey = 'index' | 'avgVerticalSpeed' | 'avgGrade' | 'duration';
interface Sort {
  key: SortKey;
  desc: boolean;
}

interface Props {
  segments: Segment[];
  theme: Theme;
  /** Segment hovered on the chart, shown as the active row. */
  activeIndex: number | null;
  onHover: (index: number | null) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'duration', label: 'Duration' },
  { key: 'avgVerticalSpeed', label: 'Vert. speed' },
  { key: 'avgGrade', label: 'Grade' },
];

export function SegmentTable({ segments, theme, activeIndex, onHover }: Props) {
  const [sort, setSort] = useState<Sort>({ key: 'index', desc: false });

  const rows = useMemo(() => {
    const idx = segments.map((_, i) => i);
    if (sort.key === 'index') return sort.desc ? idx.reverse() : idx;
    const k = sort.key;
    return idx.sort((a, b) => (segments[a][k] - segments[b][k]) * (sort.desc ? -1 : 1) || a - b);
  }, [segments, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'index' }));

  const sortHeader = (key: SortKey, label: string, className = '') => {
    const active = sort.key === key;
    return (
      <th
        key={key}
        className={`num ${className}`}
        aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      >
        <button type="button" className={`sort${active ? ' sort-active' : ''}`} onClick={() => toggle(key)}>
          {label}
          <span className="sort-arrow" aria-hidden>
            {active ? (sort.desc ? '↓' : '↑') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section className="card segments" aria-labelledby="segments-title">
      <div className="card-head">
        <h2 id="segments-title">Segments</h2>
        <span className="muted">{segments.length} segments · hover or tap a row to locate it</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {sortHeader('index', '#', 'col-idx')}
              <th>Type</th>
              <th className="num col-range">Km</th>
              {COLUMNS.map((c) => sortHeader(c.key, c.label))}
              <th className="num col-gain">D+ / D−</th>
            </tr>
          </thead>
          <tbody onMouseLeave={() => onHover(null)}>
            {rows.map((i) => {
              const s = segments[i];
              return (
                <tr
                  key={i}
                  tabIndex={0}
                  className={activeIndex === i ? 'active' : undefined}
                  onMouseEnter={() => onHover(i)}
                  onFocus={() => onHover(i)}
                  onBlur={() => onHover(null)}
                >
                  <td className="num col-idx muted">{i + 1}</td>
                  <td>
                    <span className="seg-type">
                      <i className="swatch" style={{ background: segmentColor(s, theme) }} />
                      <span className="seg-label">{directionLabel(s.direction)}</span>
                    </span>
                  </td>
                  <td className="num col-range">
                    {(s.startDistance / 1000).toFixed(1)}–{(s.endDistance / 1000).toFixed(1)}
                    <span className="muted"> ({formatKm(s.endDistance - s.startDistance, 1)})</span>
                  </td>
                  <td className="num">{formatDuration(s.duration)}</td>
                  <td className="num strong">{formatVerticalSpeed(s.avgVerticalSpeed)}</td>
                  <td className="num">{formatGrade(s.avgGrade)}</td>
                  <td className="num col-gain">
                    {formatElevation(s.gain)} / {formatElevation(s.loss)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
