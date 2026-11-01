import type { Activity, PauseInterval, TrackPoint } from '../types';

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One leg of a synthetic activity: constant horizontal speed (m/s) and vertical speed (m/h). */
export interface Leg {
  durationSec: number;
  speedMps: number;
  vamMph: number;
  /** Timer stopped during this leg: no samples are recorded and the interval is reported as a pause. */
  paused?: boolean;
}

export interface BuildOptions {
  /** Sample interval in seconds, or a function giving the next interval. Default 1. */
  dt?: number | (() => number);
  /** Uniform altitude noise amplitude (± metres). */
  noiseM?: number;
  seed?: number;
  startAltitude?: number;
}

export function buildActivity(legs: Leg[], opts: BuildOptions = {}): Activity {
  const random = rng(opts.seed ?? 1);
  const nextDt = typeof opts.dt === 'function' ? opts.dt : () => (opts.dt as number | undefined) ?? 1;
  const noise = opts.noiseM ?? 0;
  const points: TrackPoint[] = [];
  const pauses: PauseInterval[] = [];
  let t = 0;
  let dist = 0;
  let alt = opts.startAltitude ?? 1000;
  const push = () =>
    points.push({ t, distance: dist, altitude: alt + (random() * 2 - 1) * noise, lat: null, lon: null, heartRate: null });
  push();
  for (const leg of legs) {
    const end = t + leg.durationSec;
    if (leg.paused) {
      pauses.push({ start: t, end });
      t = end;
      continue;
    }
    while (t < end - 1e-9) {
      const step = Math.min(nextDt(), end - t);
      t += step;
      dist += leg.speedMps * step;
      alt += (leg.vamMph / 3600) * step;
      push();
    }
  }
  return { name: 'synthetic', sport: 'running', startTime: new Date(0), points, pauses, deviceTotals: null };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}
