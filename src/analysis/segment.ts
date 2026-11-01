import type { Direction, Segment } from '../types';

/*
 * Contiguity convention
 * ---------------------
 * Segments PARTITION the points: segments[0].startIndex = 0, segments[k+1].startIndex =
 * segments[k].endIndex + 1, and the last endIndex = points.length - 1. Every point therefore belongs to
 * exactly one segment (its segmentIndex).
 *
 * Segment statistics (distance, duration, gain/loss, speeds, grade) are measured from the segment's first
 * point up to the NEXT segment's first point (the last segment up to its own last point), so the step
 * between two segments is counted once, in the earlier segment. Consequently
 * segments[k].endDistance === segments[k+1].startDistance, and durations / gains / losses sum exactly to
 * the activity totals.
 */

export interface Series {
  movingTime: Float64Array;
  distance: Float64Array;
  /** Smoothed altitude. */
  altitude: Float64Array;
}

/**
 * Zigzag with hysteresis: indices where the altitude reverses by at least `threshold` metres. Returned
 * list always starts with 0; each entry is the start index of a monotone-ish run. Turning points sit on
 * the extreme (local max/min) sample.
 */
export function findTurningPoints(alt: Float64Array, threshold: number): number[] {
  const n = alt.length;
  const turns = [0];
  if (n < 2) return turns;
  const th = Math.max(0, threshold);
  const reversed = (delta: number) => delta >= th && delta > 0;

  let dir = 0; // 0 unknown, 1 up, -1 down
  let maxIdx = 0;
  let minIdx = 0;
  for (let i = 1; i < n; i++) {
    const a = alt[i];
    if (dir === 0) {
      if (a > alt[maxIdx]) maxIdx = i;
      if (a < alt[minIdx]) minIdx = i;
      if (reversed(a - alt[minIdx])) {
        // Going up. A dip before the minimum is smaller than the threshold: fold it into the climb.
        dir = 1;
        maxIdx = i;
      } else if (reversed(alt[maxIdx] - a)) {
        dir = -1;
        minIdx = i;
      }
    } else if (dir === 1) {
      if (a >= alt[maxIdx]) maxIdx = i;
      else if (reversed(alt[maxIdx] - a)) {
        turns.push(maxIdx);
        dir = -1;
        minIdx = i;
      }
    } else {
      if (a <= alt[minIdx]) minIdx = i;
      else if (reversed(a - alt[minIdx])) {
        turns.push(minIdx);
        dir = 1;
        maxIdx = i;
      }
    }
  }
  return turns;
}

/** Stats of the span [start, statEnd] (statEnd = next segment's start, or last point). */
function spanStats(s: Series, start: number, statEnd: number) {
  const { movingTime, distance, altitude } = s;
  let gain = 0;
  let loss = 0;
  for (let i = start + 1; i <= statEnd; i++) {
    const d = altitude[i] - altitude[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  const duration = movingTime[statEnd] - movingTime[start];
  const dist = distance[statEnd] - distance[start];
  const net = altitude[statEnd] - altitude[start];
  return {
    startDistance: distance[start],
    endDistance: distance[statEnd],
    duration,
    gain,
    loss,
    net,
    dist,
    avgVerticalSpeed: duration > 0 ? (net / duration) * 3600 : 0,
    avgGrade: dist > 0 ? (net / dist) * 100 : 0,
  };
}

function classify(net: number, dist: number, grade: number, threshold: number, flatGradePct: number): Direction {
  if (dist > 0) {
    if (Math.abs(grade) < flatGradePct || net === 0) return 'flat';
  } else if (Math.abs(net) < Math.max(threshold, Number.MIN_VALUE)) {
    // No horizontal distance (e.g. stairs on a treadmill): only a real elevation change counts.
    return 'flat';
  }
  return net > 0 ? 'up' : 'down';
}

/** Plateau band as a fraction of the hysteresis threshold (see buildSegments). */
const PLATEAU_BAND_FRACTION = 1 / 3;
/**
 * A flat stretch made only of plateau trims must be at least this long (horizontal metres) OR last at
 * least MIN_PLATEAU_FLAT_SEC of moving time to stand as its own 'flat' segment; shorter ones (e.g. the
 * rounded top of a summit) are given back to the climb / descent they were trimmed from.
 */
export const MIN_PLATEAU_FLAT_M = 500;
export const MIN_PLATEAU_FLAT_SEC = 180;

interface Piece {
  start: number;
  direction: Direction;
  /** True if this piece is a leading/trailing plateau trimmed off a hysteresis run. */
  plateau: boolean;
  /** Direction the piece takes if the plateau trim is undone. */
  runDirection: Direction;
}

/**
 * Build contiguous segments from smoothed altitude:
 *  1. hysteresis turning points split the track into alternating runs (boundaries sit on the extreme
 *     sample: summit or valley bottom);
 *  2. each run's leading / trailing plateau (samples staying within threshold/3 of the run's start / end
 *     altitude) is split off as a candidate piece if it classifies as flat — this separates e.g. a flat
 *     valley floor from the descent before it and the climb after it, and a flat finish from the last
 *     descent;
 *  3. consecutive flat pieces that consist only of plateau trims are kept only if they are long enough
 *     (>= MIN_PLATEAU_FLAT_M or >= MIN_PLATEAU_FLAT_SEC); otherwise each piece reverts to its own run, so
 *     a short rounded summit does not become a sliver and the climb ends / descent starts at the extreme;
 *  4. remaining pieces are classified up/down/flat (|avgGrade| < flatGradePct => flat) and adjacent
 *     pieces of the same direction are merged.
 * Known limitation: a plateau in the MIDDLE of a run (climb, flat, climb with no reversal >= threshold)
 * stays inside the run.
 */
export function buildSegments(s: Series, threshold: number, flatGradePct: number): Segment[] {
  const n = s.altitude.length;
  if (n === 0) return [];
  const alt = s.altitude;
  const turns = findTurningPoints(alt, threshold);
  const band = Math.max(threshold * PLATEAU_BAND_FRACTION, 0);
  const classifySpan = (a: number, b: number): Direction => {
    const st = spanStats(s, a, b);
    return classify(st.net, st.dist, st.avgGrade, threshold, flatGradePct);
  };

  // 1-2: runs and plateau trims.
  const pieces: Piece[] = [];
  for (let k = 0; k < turns.length; k++) {
    const runStart = turns[k];
    const runEnd = k + 1 < turns.length ? turns[k + 1] : n - 1;
    let p = runStart;
    while (p < runEnd && Math.abs(alt[p + 1] - alt[runStart]) <= band) p++;
    let q = runEnd;
    while (q > p && Math.abs(alt[q - 1] - alt[runEnd]) <= band) q--;

    const leadFlat = p > runStart && p < runEnd && classifySpan(runStart, p) === 'flat';
    const trailFlat = q < runEnd && q > runStart && classifySpan(q, runEnd) === 'flat';
    const coreStart = leadFlat ? p : runStart;
    const coreEnd = trailFlat ? q : runEnd;
    const runDirection = coreEnd > coreStart ? classifySpan(coreStart, coreEnd) : classifySpan(runStart, runEnd);
    if (leadFlat) pieces.push({ start: runStart, direction: 'flat', plateau: true, runDirection });
    if (coreEnd > coreStart || (!leadFlat && !trailFlat)) {
      pieces.push({ start: coreStart, direction: runDirection, plateau: false, runDirection });
    }
    if (trailFlat) pieces.push({ start: q, direction: 'flat', plateau: true, runDirection });
  }

  // 3: drop short flat groups made only of plateau trims.
  const pieceEnd = (i: number) => (i + 1 < pieces.length ? pieces[i + 1].start : n - 1);
  for (let i = 0; i < pieces.length; ) {
    if (pieces[i].direction !== 'flat') {
      i++;
      continue;
    }
    let j = i;
    let allPlateau = true;
    while (j < pieces.length && pieces[j].direction === 'flat') allPlateau = pieces[j++].plateau && allPlateau;
    const a = pieces[i].start;
    const b = pieceEnd(j - 1);
    const longEnough =
      s.distance[b] - s.distance[a] >= MIN_PLATEAU_FLAT_M || s.movingTime[b] - s.movingTime[a] >= MIN_PLATEAU_FLAT_SEC;
    if (allPlateau && !longEnough) {
      for (let k = i; k < j; k++) pieces[k].direction = pieces[k].runDirection;
    }
    i = j;
  }

  // 4: drop zero-length pieces (start at the last point, or duplicated starts) and merge.
  const merged: { start: number; direction: Direction }[] = [];
  for (const pc of pieces) {
    const last = merged[merged.length - 1];
    if (last && (pc.start >= n - 1 || pc.start <= last.start || pc.direction === last.direction)) continue;
    merged.push({ start: pc.start, direction: pc.direction });
  }

  return merged.map((m, k) => {
    const endIndex = k + 1 < merged.length ? merged[k + 1].start - 1 : n - 1;
    const statEnd = k + 1 < merged.length ? merged[k + 1].start : n - 1;
    const st = spanStats(s, m.start, statEnd);
    return {
      direction: m.direction,
      startIndex: m.start,
      endIndex,
      startDistance: st.startDistance,
      endDistance: st.endDistance,
      duration: st.duration,
      gain: st.gain,
      loss: st.loss,
      avgVerticalSpeed: st.avgVerticalSpeed,
      avgGrade: st.avgGrade,
    };
  });
}
