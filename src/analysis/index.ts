import type { Activity, AnalysisOptions, AnalysisResult, ProcessedPoint } from '../types';
import { cleanPoints } from './clean';
import { computeMovingTime } from './moving';
import { rollingVerticalSpeed, smoothByTime } from './smooth';
import { buildSegments } from './segment';
import { emptySummary, summarize } from './summary';

const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

/**
 * Turn a parsed Activity into plot-ready data. Pure and synchronous; O(n log n).
 *
 * Pipeline: clean (sort/dedupe time, interpolate short altitude gaps) -> moving time (timer pauses +
 * auto-detected stops removed) -> time-based altitude smoothing on the moving clock -> centred rolling
 * vertical speed -> hysteresis segmentation (up/down/flat, merged) -> segment stats and summary.
 * See segment.ts for the segment contiguity convention.
 *
 * Throws if the activity has points but no altitude at all.
 */
export function analyzeActivity(activity: Activity, options: AnalysisOptions): AnalysisResult {
  const track = cleanPoints(activity.points);
  const n = track.t.length;
  if (n === 0) return { points: [], segments: [], summary: emptySummary() };

  const smoothingWindowSec = Math.max(0, finiteOr(options.smoothingWindowSec, 0));
  const verticalSpeedWindowSec = Math.max(0, finiteOr(options.verticalSpeedWindowSec, 0));
  const segmentThresholdM = Math.max(0, finiteOr(options.segmentThresholdM, 0));
  const flatGradePct = Math.max(0, finiteOr(options.flatGradePct, 0));

  const movingTime = computeMovingTime(track.t, track.distance, track.altitude, activity.pauses ?? []);
  const altitude = smoothByTime(movingTime, track.altitude, smoothingWindowSec);
  const verticalSpeed = rollingVerticalSpeed(movingTime, altitude, verticalSpeedWindowSec);
  const segments = buildSegments({ movingTime, distance: track.distance, altitude }, segmentThresholdM, flatGradePct);

  const points: ProcessedPoint[] = new Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    while (i > segments[seg].endIndex) seg++;
    points[i] = {
      movingTime: movingTime[i],
      elapsedTime: track.t[i],
      distance: track.distance[i],
      altitude: altitude[i],
      verticalSpeed: verticalSpeed[i],
      segmentIndex: seg,
    };
  }

  return { points, segments, summary: summarize(segments, track.t, movingTime, track.distance) };
}
