/**
 * Test fixture: ~1 hour of 1 Hz records over a steady climb then a descent,
 * with a 5 minute timer pause in the middle. Built in memory with the SDK Encoder.
 */
import { encodeActivity, type EncodeRecord, type EncodeTimerEvent } from '../encode';

export const FIXTURE_START = new Date('2024-05-04T08:00:00Z');
export const FIXTURE_START_LAT = 46.5;
export const FIXTURE_START_LON = 7.5;
/** Pause: timer stopped at t=1800 s, restarted at t=2100 s. */
export const FIXTURE_PAUSE = { start: 1800, end: 2100 };
/** Seconds of recording before and after the pause (1 Hz, inclusive endpoints). */
export const FIXTURE_RECORDS_BEFORE = 1800; // t = 0..1799
export const FIXTURE_RECORDS_AFTER = 1500; // t = 2100..3599
export const FIXTURE_SPEED = 2.5; // m/s, heading due north

export interface ClimbDescentOptions {
  /** Which altitude field to write. */
  altitudeField?: 'enhancedAltitude' | 'altitude' | 'none';
  includeDistance?: boolean;
  includePositions?: boolean;
  /** Add a trailing unmatched timer stop at the end. Default true. */
  trailingStop?: boolean;
  /** Use 'stopAll' instead of 'stop' for the mid-activity pause. */
  pauseEventType?: 'stop' | 'stopAll';
  /** null = write no session message. */
  sport?: string | null;
}

/** Altitude at moving-time second `m`: 900 m -> +600 m over 30 min, then down 500 m. */
export function fixtureAltitude(movingS: number): number {
  return movingS < 1800 ? 900 + movingS / 3 : 1500 - (movingS - 1800) / 3;
}

export function buildClimbDescentFit(opts: ClimbDescentOptions = {}): Uint8Array {
  const {
    altitudeField = 'enhancedAltitude',
    includeDistance = true,
    includePositions = true,
    trailingStop = true,
    pauseEventType = 'stop',
    sport = 'running',
  } = opts;

  const records: EncodeRecord[] = [];
  const times = [
    ...Array.from({ length: FIXTURE_RECORDS_BEFORE }, (_, i) => i),
    ...Array.from({ length: FIXTURE_RECORDS_AFTER }, (_, i) => FIXTURE_PAUSE.end + i),
  ];
  for (const t of times) {
    const moving = t < FIXTURE_PAUSE.start ? t : t - (FIXTURE_PAUSE.end - FIXTURE_PAUSE.start);
    const distance = moving * FIXTURE_SPEED;
    const r: EncodeRecord = { t, heartRate: 140 };
    if (includeDistance) r.distance = distance;
    if (includePositions) {
      r.lat = FIXTURE_START_LAT + distance / 111_195; // ~metres per degree latitude
      r.lon = FIXTURE_START_LON;
    }
    if (altitudeField !== 'none') r[altitudeField] = Math.round(fixtureAltitude(moving) * 10) / 10;
    records.push(r);
  }

  const timerEvents: EncodeTimerEvent[] = [
    { t: 0, eventType: 'start' },
    { t: FIXTURE_PAUSE.start, eventType: pauseEventType },
    { t: FIXTURE_PAUSE.end, eventType: 'start' },
  ];
  if (trailingStop) timerEvents.push({ t: 3599, eventType: 'stopAll' });

  return encodeActivity({ startTime: FIXTURE_START, records, timerEvents, sport: sport ?? undefined,
    totalAscent: 600,
    totalDescent: 500,
  });
}

/** Copy a Uint8Array into a standalone ArrayBuffer (what the browser File API gives you). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
