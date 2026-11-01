/**
 * Shared data contracts between the three layers:
 *   fit/      FIT file bytes  -> Activity
 *   analysis/ Activity        -> AnalysisResult
 *   ui/       AnalysisResult  -> chart
 * Do not change these without coordinating with the lead.
 */

/** One recorded sample, after parsing. Units are SI. */
export interface TrackPoint {
  /** Seconds since activity start (wall clock, includes pauses). */
  t: number;
  /** Cumulative distance in metres (from the device if available, else computed from lat/lon). */
  distance: number;
  /** Altitude in metres (prefer enhanced/barometric altitude). null if missing for this sample. */
  altitude: number | null;
  lat: number | null;
  lon: number | null;
  heartRate: number | null;
}

/** A time range during which the timer was stopped (from FIT timer events). Seconds since start. */
export interface PauseInterval {
  start: number;
  end: number;
}

export interface Activity {
  name: string;
  sport: string | null;
  startTime: Date;
  points: TrackPoint[];
  /** Timer stop/start pairs from the FIT file. Empty if none. */
  pauses: PauseInterval[];
}

export type Direction = 'up' | 'down' | 'flat';

/** A point after cleaning, ready for plotting. */
export interface ProcessedPoint {
  /** Moving time in seconds (pauses removed). */
  movingTime: number;
  /** Elapsed time in seconds (wall clock). */
  elapsedTime: number;
  distance: number;
  /** Smoothed altitude in metres. */
  altitude: number;
  /** Rolling vertical speed in metres per hour (positive = climbing). */
  verticalSpeed: number;
  /** Index of the Segment this point belongs to. */
  segmentIndex: number;
}

export interface Segment {
  direction: Direction;
  /** Inclusive start, inclusive end index into AnalysisResult.points. */
  startIndex: number;
  endIndex: number;
  startDistance: number;
  endDistance: number;
  /** Moving time spent in the segment (seconds). */
  duration: number;
  /** Total positive / negative elevation change inside the segment (metres, both >= 0). */
  gain: number;
  loss: number;
  /** Net elevation change / moving duration, m/h (positive up, negative down). */
  avgVerticalSpeed: number;
  /** Net elevation change / horizontal distance, in percent. */
  avgGrade: number;
}

export interface AnalysisOptions {
  /** Smoothing window in seconds. */
  smoothingWindowSec: number;
  /** Hysteresis in metres: a direction change needs at least this much reversal. */
  segmentThresholdM: number;
  /** Segments whose |avgGrade| is below this percent are classified as flat. */
  flatGradePct: number;
  /** Window in seconds for the rolling vertical speed. */
  verticalSpeedWindowSec: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  smoothingWindowSec: 30,
  segmentThresholdM: 15,
  flatGradePct: 3,
  verticalSpeedWindowSec: 60,
};

export interface ActivitySummary {
  totalDistance: number;
  movingTime: number;
  elapsedTime: number;
  totalGain: number;
  totalLoss: number;
  /** Average vertical speed over all 'up' segments, m/h. */
  avgClimbSpeed: number;
  /** Average vertical speed over all 'down' segments, m/h (negative). */
  avgDescentSpeed: number;
}

export interface AnalysisResult {
  points: ProcessedPoint[];
  segments: Segment[];
  summary: ActivitySummary;
}
