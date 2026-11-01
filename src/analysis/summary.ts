import type { ActivitySummary, DeviceTotals, Segment } from '../types';

export function emptySummary(): ActivitySummary {
  return { totalDistance: 0, movingTime: 0, elapsedTime: 0, totalGain: 0, totalLoss: 0, avgClimbSpeed: 0, avgDescentSpeed: 0 };
}

/** Moving-time-weighted average vertical speed (m/h) over segments of one direction: sum(net) / sum(duration). */
function weightedSpeed(segments: readonly Segment[], direction: 'up' | 'down'): number {
  let net = 0;
  let dur = 0;
  for (const s of segments) {
    if (s.direction !== direction) continue;
    net += (s.avgVerticalSpeed * s.duration) / 3600;
    dur += s.duration;
  }
  return dur > 0 ? (net / dur) * 3600 : 0;
}

export function summarize(
  segments: readonly Segment[],
  t: Float64Array,
  movingTime: Float64Array,
  distance: Float64Array,
): ActivitySummary {
  const n = t.length;
  if (n === 0) return emptySummary();
  let totalGain = 0;
  let totalLoss = 0;
  for (const s of segments) {
    totalGain += s.gain;
    totalLoss += s.loss;
  }
  return {
    totalDistance: distance[n - 1] - distance[0],
    movingTime: movingTime[n - 1],
    elapsedTime: t[n - 1] - t[0],
    totalGain,
    totalLoss,
    avgClimbSpeed: weightedSpeed(segments, 'up'),
    avgDescentSpeed: weightedSpeed(segments, 'down'),
  };
}

const usable = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Prefer the device's own session totals (so D+, D- and distance match Garmin Connect and do not depend
 * on the smoothing setting); each field falls back to the computed value when null / invalid.
 * movingTime always stays computed (it also removes auto-detected stops); segment-based speeds are
 * untouched.
 */
export function applyDeviceTotals(summary: ActivitySummary, device: DeviceTotals | null | undefined): ActivitySummary {
  if (!device) return summary;
  return {
    ...summary,
    totalGain: usable(device.totalAscent) ? device.totalAscent : summary.totalGain,
    totalLoss: usable(device.totalDescent) ? device.totalDescent : summary.totalLoss,
    totalDistance: usable(device.totalDistance) ? device.totalDistance : summary.totalDistance,
    elapsedTime: usable(device.elapsedTime) ? device.elapsedTime : summary.elapsedTime,
  };
}
