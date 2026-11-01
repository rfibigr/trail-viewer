/**
 * DEV ONLY: deterministic mock AnalysisResult so the UI can be built and screenshotted
 * before src/fit and src/analysis land. Reacts to AnalysisOptions with a crude
 * smoothing / hysteresis segmentation so the settings sliders do something visible.
 *
 * Not a reference implementation of the analysis module.
 */
import type { AnalysisOptions, AnalysisResult, Direction, ProcessedPoint, Segment } from '../../types';

/** mulberry32 seeded PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [km, altitude m] waypoints of a ~42 km mountain trail with ~2,600 m D+. */
const WAYPOINTS: [number, number][] = [
  [0, 650], [1.2, 700], [3.0, 1080], [5.0, 1460], [6.2, 1390], [8.0, 1120],
  [11.0, 1640], [14.0, 2120], [15.0, 2090], [17.5, 1640], [20.0, 1260],
  [21.5, 1245], [24.0, 1230], [26.5, 1560], [29.0, 1910], [31.0, 1720],
  [33.5, 1260], [36.0, 900], [38.0, 960], [40.0, 760], [42.2, 640],
];

/** Monotone-ish cosine interpolation between waypoints. */
function baseAltitude(km: number): number {
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const [k1, a1] = WAYPOINTS[i];
    const [k0, a0] = WAYPOINTS[i - 1];
    if (km <= k1) {
      const t = (km - k0) / (k1 - k0);
      return a0 + (a1 - a0) * (1 - Math.cos(Math.PI * t)) / 2;
    }
  }
  return WAYPOINTS[WAYPOINTS.length - 1][1];
}

interface RawPoint {
  elapsed: number;
  moving: number;
  distance: number;
  altitude: number;
}

let rawCache: RawPoint[] | null = null;

/** Raw recording: one point per 6 m, time from a Tobler-style speed model, two aid-station pauses. */
function rawTrack(): RawPoint[] {
  if (rawCache) return rawCache;
  const rand = rng(42);
  const step = 6;
  const total = 42200;
  const pts: RawPoint[] = [];
  let moving = 0;
  let elapsed = 0;
  let noise = 0;
  const pauses: [number, number][] = [[14100, 240], [24000, 420], [33600, 180]];
  let prevAlt = baseAltitude(0);
  for (let d = 0; d <= total; d += step) {
    const km = d / 1000;
    // small rolling bumps + baro noise (random walk, mean-reverting)
    noise = noise * 0.97 + (rand() - 0.5) * 0.8;
    const bumps = 6 * Math.sin(km * 7.3) + 3 * Math.sin(km * 19.1 + 1);
    const alt = baseAltitude(km) + bumps + noise;
    if (d > 0) {
      const grade = (alt - prevAlt) / step;
      const fatigue = 1 - 0.25 * (km / 42.2);
      const kmh = 12 * Math.exp(-2.8 * Math.abs(grade + 0.05)) * fatigue * (0.93 + rand() * 0.14);
      const dt = step / (Math.max(kmh, 1.5) / 3.6);
      moving += dt;
      elapsed += dt;
    }
    for (const [at, dur] of pauses) if (d - step < at && d >= at) elapsed += dur;
    pts.push({ elapsed, moving, distance: d, altitude: alt });
    prevAlt = alt;
  }
  rawCache = pts;
  return pts;
}

/** Centred moving average over a time window (moving time), two-pointer. */
function smooth(raw: RawPoint[], windowSec: number): number[] {
  if (windowSec <= 0) return raw.map((p) => p.altitude);
  const half = windowSec / 2;
  const out = new Array<number>(raw.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].moving;
    while (hi < raw.length && raw[hi].moving <= t + half) sum += raw[hi++].altitude;
    while (raw[lo].moving < t - half) sum -= raw[lo++].altitude;
    out[i] = sum / (hi - lo);
  }
  return out;
}

function interpAt(times: number[], values: number[], t: number, hint: number): [number, number] {
  let i = hint;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  while (i > 0 && times[i] > t) i--;
  if (i >= times.length - 1) return [values[times.length - 1], i];
  const t0 = times[i];
  const t1 = times[i + 1];
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  return [values[i] + (values[i + 1] - values[i]) * k, i];
}

export function mockAnalysisResult(options: AnalysisOptions): AnalysisResult {
  const raw = rawTrack();
  const alt = smooth(raw, options.smoothingWindowSec);
  const times = raw.map((p) => p.moving);
  const tEnd = times[times.length - 1];

  // Rolling vertical speed: centred difference over the window.
  const w = Math.max(options.verticalSpeedWindowSec, 1);
  const vs = new Array<number>(raw.length);
  let hA = 0;
  let hB = 0;
  for (let i = 0; i < raw.length; i++) {
    const ta = Math.max(0, times[i] - w / 2);
    const tb = Math.min(tEnd, times[i] + w / 2);
    const [a, ia] = interpAt(times, alt, ta, hA);
    const [b, ib] = interpAt(times, alt, tb, hB);
    hA = ia;
    hB = ib;
    vs[i] = tb > ta ? ((b - a) / (tb - ta)) * 3600 : 0;
  }

  // Hysteresis segmentation: cut at extremes once reversal exceeds the threshold.
  const cuts: number[] = [0];
  const th = options.segmentThresholdM;
  let dir: 1 | -1 | 0 = 0;
  let ext = 0;
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < alt.length; i++) {
    if (dir === 0) {
      if (alt[i] > alt[maxIdx]) maxIdx = i;
      if (alt[i] < alt[minIdx]) minIdx = i;
      if (alt[maxIdx] - alt[minIdx] >= th) {
        const first = Math.min(minIdx, maxIdx);
        if (first > 0) cuts.push(first);
        dir = maxIdx > minIdx ? 1 : -1;
        ext = Math.max(minIdx, maxIdx);
      }
    } else if (dir === 1) {
      if (alt[i] > alt[ext]) ext = i;
      else if (alt[ext] - alt[i] >= th) {
        cuts.push(ext);
        dir = -1;
        ext = i;
      }
    } else {
      if (alt[i] < alt[ext]) ext = i;
      else if (alt[i] - alt[ext] >= th) {
        cuts.push(ext);
        dir = 1;
        ext = i;
      }
    }
  }
  if (cuts[cuts.length - 1] !== alt.length - 1)   cuts.push(alt.length - 1);

  const segments: Segment[] = [];
  const points: ProcessedPoint[] = raw.map((p, i) => ({
    movingTime: p.moving,
    elapsedTime: p.elapsed,
    distance: p.distance,
    altitude: alt[i],
    verticalSpeed: vs[i],
    segmentIndex: 0,
  }));

  for (let c = 1; c < cuts.length; c++) {
    const startIndex = c === 1 ? 0 : cuts[c - 1] + 1;
    const endIndex = cuts[c];
    if (endIndex < startIndex) continue;
    const from = Math.max(0, startIndex - 1); // include the step into the segment
    let gain = 0;
    let loss = 0;
    for (let i = from + 1; i <= endIndex; i++) {
      const d = alt[i] - alt[i - 1];
      if (d > 0) gain += d;
      else loss -= d;
    }
    const net = alt[endIndex] - alt[from];
    const duration = raw[endIndex].moving - raw[from].moving;
    const horiz = raw[endIndex].distance - raw[from].distance;
    const avgGrade = horiz > 0 ? (net / horiz) * 100 : 0;
    const direction: Direction =
      Math.abs(avgGrade) < options.flatGradePct ? 'flat' : net > 0 ? 'up' : 'down';
    const idx = segments.length;
    for (let i = startIndex; i <= endIndex; i++) points[i].segmentIndex = idx;
    segments.push({
      direction,
      startIndex,
      endIndex,
      startDistance: raw[from].distance,
      endDistance: raw[endIndex].distance,
      duration,
      gain,
      loss,
      avgVerticalSpeed: duration > 0 ? (net / duration) * 3600 : 0,
      avgGrade,
    });
  }

  const sumBy = (dirn: Direction) => {
    let net = 0;
    let dur = 0;
    for (const s of segments)
      if (s.direction === dirn) {
        net += (s.avgVerticalSpeed * s.duration) / 3600;
        dur += s.duration;
      }
    return dur > 0 ? (net / dur) * 3600 : 0;
  };

  const last = raw[raw.length - 1];
  return {
    points,
    segments,
    summary: {
      totalDistance: last.distance,
      movingTime: last.moving,
      elapsedTime: last.elapsed,
      totalGain: segments.reduce((a, s) => a + s.gain, 0),
      totalLoss: segments.reduce((a, s) => a + s.loss, 0),
      avgClimbSpeed: sumBy('up'),
      avgDescentSpeed: sumBy('down'),
    },
  };
}

export const MOCK_ACTIVITY_NAME = 'Mock: Alpine Trail 42K';
