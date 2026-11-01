/** Pure helpers turning an AnalysisResult into chart-ready arrays and fill gradients. */
import type { AnalysisResult, ProcessedPoint, Segment } from '../types';
import { segmentColor, verticalSpeedColor, type Theme } from './colors';

export type XMode = 'distance' | 'time';
export type ColorMode = 'segment' | 'point';

export interface GradientStop {
  offset: number;
  color: string;
}

/** x value per point: km for distance, hours of moving time for time. */
export function xValues(points: readonly ProcessedPoint[], mode: XMode): number[] {
  return mode === 'distance'
    ? points.map((p) => p.distance / 1000)
    : points.map((p) => p.movingTime / 3600);
}

/** Index of the point whose x is closest to `x`. `xs` must be non-decreasing. */
export function nearestIndex(xs: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

/**
 * First point index of the drawn span of segment k. The interval between the previous
 * segment's last point and this segment's first point is drawn in this segment's colour,
 * so colour changes happen exactly at the previous segment's end (the summit / valley).
 */
export function segmentDrawStart(segments: readonly Segment[], k: number): number {
  return k === 0 ? segments[0].startIndex : Math.min(segments[k - 1].endIndex, segments[k].startIndex);
}

/** Horizontal gradient stops (0..1 across the data x-extent) for the area fill. */
export function fillStops(
  result: AnalysisResult,
  xs: readonly number[],
  colorMode: ColorMode,
  theme: Theme,
  maxBins = 600,
): GradientStop[] {
  const n = xs.length;
  if (n < 2) return [{ offset: 0, color: '#999999' }, { offset: 1, color: '#999999' }];
  const x0 = xs[0];
  const span = xs[n - 1] - x0 || 1;
  const off = (x: number) => Math.min(1, Math.max(0, (x - x0) / span));

  if (colorMode === 'segment' && result.segments.length > 0) {
    const stops: GradientStop[] = [];
    result.segments.forEach((seg, k) => {
      const color = segmentColor(seg, theme);
      const start = k === 0 ? 0 : off(xs[segmentDrawStart(result.segments, k)] ?? x0);
      const end = k === result.segments.length - 1 ? 1 : off(xs[seg.endIndex] ?? xs[n - 1]);
      stops.push({ offset: start, color }, { offset: Math.max(start, end), color });
    });
    return stops;
  }

  // Per-point: average vertical speed in equal-width x bins, one stop per bin centre.
  const bins = Math.max(2, Math.min(maxBins, n));
  const sum = new Float64Array(bins);
  const count = new Uint32Array(bins);
  result.points.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor(off(xs[i]) * bins));
    if (Number.isFinite(p.verticalSpeed)) {
      sum[b] += p.verticalSpeed;
      count[b]++;
    }
  });
  // Light triangular smoothing across neighbouring bins so the fill reads as a gradient, not barcode.
  const stops: GradientStop[] = [];
  const radius = 2;
  for (let b = 0; b < bins; b++) {
    if (count[b] === 0) continue; // empty bins (e.g. pauses on a time axis): neighbours blend over them
    let s = 0;
    let c = 0;
    for (let j = -radius; j <= radius; j++) {
      const k = b + j;
      if (k < 0 || k >= bins || count[k] === 0) continue;
      const w = radius + 1 - Math.abs(j);
      s += (sum[k] / count[k]) * w;
      c += w;
    }
    stops.push({ offset: (b + 0.5) / bins, color: verticalSpeedColor(s / c) });
  }
  if (stops.length === 0) stops.push({ offset: 0, color: verticalSpeedColor(0) });
  // anchor ends so the fill doesn't rely on renderer edge behaviour
  stops.unshift({ offset: 0, color: stops[0].color });
  stops.push({ offset: 1, color: stops[stops.length - 1].color });
  return stops;
}

/** Nice y-range with some headroom, snapped to a round tick interval (so ECharts doesn't add odd end ticks). */
export function altitudeRange(points: readonly ProcessedPoint[], targetTicks = 6): [number, number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.altitude < lo) lo = p.altitude;
    if (p.altitude > hi) hi = p.altitude;
  }
  if (!Number.isFinite(lo)) return [0, 100, 20];
  const pad = Math.max(10, (hi - lo) * 0.06);
  const span = hi - lo + 2 * pad;
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce((best, s) =>
    Math.abs(span / s - targetTicks) < Math.abs(span / best - targetTicks) ? s : best,
  );
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad * 0.5) / step) * step, step];
}
