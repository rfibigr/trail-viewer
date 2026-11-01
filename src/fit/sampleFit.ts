/**
 * Deterministic demo trail run, encoded as a FIT file in memory.
 * Browser-safe; suitable for a "load demo activity" button:
 *
 *   const bytes = buildSampleFit();
 *   const activity = await parseFitFile(bytes.slice().buffer, 'Demo trail run.fit');
 *
 * Course (~18 km, ~1500 m D+), 1 Hz records:
 *   gentle warm-up, a long ~20 % climb, a short summit plateau with a 4 min aid-station stop
 *   (timer stop/start), a ~15 % descent, a very steep ~40 % "vertical km" style climb,
 *   a steep ~23 % descent, a small bump, then a long ~18 % descent back to the start altitude.
 */
import { encodeActivity, type EncodeRecord, type EncodeTimerEvent } from './encode';

export const SAMPLE_FIT_START = new Date('2024-07-13T05:30:00Z');

/** [horizontal distance (m), altitude (m)] waypoints of the course profile. */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 1035],
  [1000, 1085],
  [4500, 1785],
  [5000, 1795],
  [8000, 1335],
  [9000, 1315],
  [10500, 1955],
  [11500, 1935],
  [13000, 1585],
  [14000, 1685],
  [17500, 1055],
  [18000, 1035],
];
const COURSE_LENGTH = PROFILE[PROFILE.length - 1][0];
/** True D+ / D- of the course profile, metres. */
export const SAMPLE_TOTAL_ASCENT = Math.round(
  PROFILE.slice(1).reduce((acc, [, a], i) => acc + Math.max(0, a - PROFILE[i][1]), 0),
);
export const SAMPLE_TOTAL_DESCENT = Math.round(
  PROFILE.slice(1).reduce((acc, [, a], i) => acc + Math.max(0, PROFILE[i][1] - a), 0),
);
/** Distance at which the runner stops at the aid station, and for how long (s). */
const AID_STATION_DISTANCE = 4750;
const AID_STATION_STOP_S = 240;

const START_LAT = 45.9237;
const START_LON = 6.8694;
const M_PER_DEG_LAT = 111_320;

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function profileAt(d: number): { alt: number; grade: number } {
  for (let i = 1; i < PROFILE.length; i++) {
    const [d1, a1] = PROFILE[i];
    if (d <= d1 || i === PROFILE.length - 1) {
      const [d0, a0] = PROFILE[i - 1];
      const grade = (a1 - a0) / (d1 - d0);
      return { alt: a0 + grade * (Math.min(d, d1) - d0), grade };
    }
  }
  return { alt: PROFILE[0][1], grade: 0 };
}

/** Horizontal running/hiking speed (m/s) as a function of grade (Tobler-style). */
function speedForGrade(grade: number): number {
  return 3.4 * Math.exp(-3.5 * Math.abs(grade + 0.05));
}

/** Build the demo activity FIT file. Same bytes on every call. */
export function buildSampleFit(): Uint8Array {
  const rand = mulberry32(20240713);
  const records: EncodeRecord[] = [];
  const timerEvents: EncodeTimerEvent[] = [{ t: 0, eventType: 'start' }];

  let t = 0;
  let d = 0;
  let lat = START_LAT;
  let lon = START_LON;
  let heading = 0.6; // radians from north
  let hr = 105;
  let paceNoise = 0;
  let stopped = false;

  for (;;) {
    const { alt, grade } = profileAt(d);
    // Barometric-like altitude: smooth wobble + a little sensor jitter.
    const altitude = alt + 1.5 * Math.sin(d / 180) + (rand() - 0.5) * 0.6;
    const vs = speedForGrade(grade) * grade * 3600; // m/h at current grade
    hr += ((125 + Math.max(0, vs) * 0.045 + Math.max(0, -vs) * 0.008) - hr) * 0.03 + (rand() - 0.5) * 1.2;

    records.push({
      t,
      lat: round(lat, 7),
      lon: round(lon, 7),
      enhancedAltitude: round(altitude, 1),
      distance: round(d, 2),
      heartRate: Math.round(hr),
    });
    if (d >= COURSE_LENGTH) break;

    if (!stopped && d >= AID_STATION_DISTANCE) {
      // Timer stopped at the aid station: no records are written while paused.
      stopped = true;
      timerEvents.push({ t: t + 1, eventType: 'stop' });
      t += 1 + AID_STATION_STOP_S;
      timerEvents.push({ t, eventType: 'start' });
      hr -= 25;
      continue;
    }

    paceNoise = 0.9 * paceNoise + (rand() - 0.5) * 0.08;
    const step = Math.max(0.3, speedForGrade(grade) * (1 + paceNoise));
    d = Math.min(COURSE_LENGTH, d + step);
    // Meandering path: slowly turning heading, loops back toward the start in the second half.
    heading += 0.004 * Math.sin(d / 700) + (d > COURSE_LENGTH / 2 ? 0.00035 * step : 0);
    lat += (step * Math.cos(heading)) / M_PER_DEG_LAT;
    lon += (step * Math.sin(heading)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    t += 1;
  }

  timerEvents.push({ t, eventType: 'stopAll' });

  return encodeActivity({
    startTime: SAMPLE_FIT_START,
    records,
    timerEvents,
    sport: 'running',
    subSport: 'trail',
    // What a Garmin would report: the course's true climb/descent, whole metres
    // (its own filtering removes the sensor wobble we add to the records).
    totalAscent: SAMPLE_TOTAL_ASCENT,
    totalDescent: SAMPLE_TOTAL_DESCENT,
  });
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
