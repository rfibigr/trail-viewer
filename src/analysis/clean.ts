import type { TrackPoint } from '../types';

/** Gaps of missing altitude up to this long (seconds, between known neighbours) are linearly interpolated. */
export const MAX_ALTITUDE_INTERP_GAP_SEC = 120;

/** Column-oriented, cleaned track. All arrays have the same length; `t` is strictly increasing. */
export interface CleanTrack {
  t: Float64Array;
  distance: Float64Array;
  altitude: Float64Array;
}

/**
 * Clean raw track points.
 *
 * - Drops points with a non-finite timestamp, sorts by time (stable) and drops duplicate timestamps
 *   (first sample wins) so `t` is strictly increasing.
 * - Distance: non-finite values carry the previous value forward; then forced non-decreasing.
 * - Altitude: null / non-finite gaps of at most MAX_ALTITUDE_INTERP_GAP_SEC between two known samples
 *   are linearly interpolated in time; samples in longer gaps, and leading/trailing samples without
 *   altitude, are dropped (the profile then simply bridges the gap).
 *
 * Throws if the activity has points but none of them carries an altitude.
 */
export function cleanPoints(points: readonly TrackPoint[]): CleanTrack {
  let pts = points.filter((p) => Number.isFinite(p.t));
  let sorted = true;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t < pts[i - 1].t) {
      sorted = false;
      break;
    }
  }
  if (!sorted) pts = pts.map((p, i) => ({ p, i })).sort((a, b) => a.p.t - b.p.t || a.i - b.i).map((x) => x.p);

  const dedup: TrackPoint[] = [];
  for (const p of pts) {
    if (dedup.length === 0 || p.t > dedup[dedup.length - 1].t) dedup.push(p);
  }

  const n = dedup.length;
  const known = (p: TrackPoint) => p.altitude !== null && Number.isFinite(p.altitude);
  if (n > 0 && !dedup.some(known)) {
    throw new Error('Activity has no altitude data: cannot compute an elevation profile.');
  }

  // Decide which points to keep and their altitude.
  const keep: boolean[] = new Array(n).fill(false);
  const alt = new Float64Array(n);
  let prevKnown = -1;
  for (let i = 0; i < n; i++) {
    if (!known(dedup[i])) continue;
    alt[i] = dedup[i].altitude as number;
    keep[i] = true;
    if (prevKnown >= 0 && i - prevKnown > 1) {
      const t0 = dedup[prevKnown].t;
      const t1 = dedup[i].t;
      if (t1 - t0 <= MAX_ALTITUDE_INTERP_GAP_SEC) {
        const a0 = alt[prevKnown];
        const a1 = alt[i];
        for (let j = prevKnown + 1; j < i; j++) {
          alt[j] = a0 + ((a1 - a0) * (dedup[j].t - t0)) / (t1 - t0);
          keep[j] = true;
        }
      }
    }
    prevKnown = i;
  }

  let m = 0;
  for (let i = 0; i < n; i++) if (keep[i]) m++;
  const out: CleanTrack = { t: new Float64Array(m), distance: new Float64Array(m), altitude: new Float64Array(m) };
  let k = 0;
  let lastDist = 0;
  for (let i = 0; i < n; i++) {
    // Track distance through dropped points too so carried-forward values stay sensible.
    const d = dedup[i].distance;
    if (Number.isFinite(d) && d > lastDist) lastDist = d;
    if (!keep[i]) continue;
    out.t[k] = dedup[i].t;
    out.distance[k] = lastDist;
    out.altitude[k] = alt[i];
    k++;
  }
  return out;
}
