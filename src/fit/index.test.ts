import { describe, expect, it } from 'vitest';
import type { FitMessages } from '@garmin/fitsdk';
import {
  activityFromFitMessages,
  activityNameFromFileName,
  haversineMeters,
  parseFitFile,
  semicirclesToDegrees,
} from './index';
import { degreesToSemicircles, encodeActivity } from './encode';
import { buildSampleFit, SAMPLE_FIT_START } from './sampleFit';
import {
  buildClimbDescentFit,
  fixtureAltitude,
  FIXTURE_PAUSE,
  FIXTURE_RECORDS_AFTER,
  FIXTURE_RECORDS_BEFORE,
  FIXTURE_SPEED,
  FIXTURE_START,
  FIXTURE_START_LAT,
  FIXTURE_START_LON,
  toArrayBuffer,
} from './__fixtures__/climbDescent';

const parse = (bytes: Uint8Array, name = 'Fixture Run.fit') => parseFitFile(toArrayBuffer(bytes), name);

describe('parseFitFile – climb/descent fixture', () => {
  it('produces one point per record with SI units and t relative to the first record', async () => {
    const a = await parse(buildClimbDescentFit());
    expect(a.points).toHaveLength(FIXTURE_RECORDS_BEFORE + FIXTURE_RECORDS_AFTER);
    expect(a.startTime.toISOString()).toBe(FIXTURE_START.toISOString());

    const p0 = a.points[0];
    expect(p0.t).toBe(0);
    expect(p0.distance).toBe(0);
    expect(p0.altitude).toBeCloseTo(900, 0);
    expect(p0.heartRate).toBe(140);

    // Last point before the pause and first after it: wall-clock t jumps by the pause.
    const before = a.points[FIXTURE_RECORDS_BEFORE - 1];
    const after = a.points[FIXTURE_RECORDS_BEFORE];
    expect(before.t).toBe(1799);
    expect(after.t).toBe(2100);

    const last = a.points[a.points.length - 1];
    expect(last.t).toBe(3599);
    // Distance in metres, straight from the device field (FIT resolution 1 cm).
    expect(last.distance).toBeCloseTo((3599 - 300) * FIXTURE_SPEED, 1);
    // Altitude in metres (FIT altitude resolution 0.2 m).
    expect(Math.abs(last.altitude! - fixtureAltitude(3599 - 300))).toBeLessThanOrEqual(0.2);
    const top = Math.max(...a.points.map((p) => p.altitude!));
    expect(top).toBeGreaterThan(1499);
    expect(top).toBeLessThan(1501);

    // Monotonic time and distance.
    for (let i = 1; i < a.points.length; i++) {
      expect(a.points[i].t).toBeGreaterThan(a.points[i - 1].t);
      expect(a.points[i].distance).toBeGreaterThanOrEqual(a.points[i - 1].distance);
    }
  });

  it('derives name from file name and sport from the session', async () => {
    const a = await parse(buildClimbDescentFit(), 'Morning Trail.fit');
    expect(a.name).toBe('Morning Trail');
    expect(a.sport).toBe('running');

    const noSession = await parse(buildClimbDescentFit({ sport: null }), 'x.fit');
    expect(noSession.sport).toBeNull();
  });

  it('converts positions from semicircles to degrees', async () => {
    const a = await parse(buildClimbDescentFit());
    expect(a.points[0].lat).toBeCloseTo(FIXTURE_START_LAT, 6);
    expect(a.points[0].lon).toBeCloseTo(FIXTURE_START_LON, 6);
    const last = a.points[a.points.length - 1];
    expect(last.lat).toBeCloseTo(FIXTURE_START_LAT + last.distance / 111_195, 5);
  });

  it('extracts the timer pause and ignores the trailing unmatched stop', async () => {
    const a = await parse(buildClimbDescentFit());
    expect(a.pauses).toEqual([FIXTURE_PAUSE]);
  });

  it('accepts stopAll as a pause start and handles no trailing stop', async () => {
    const a = await parse(buildClimbDescentFit({ pauseEventType: 'stopAll', trailingStop: false }));
    expect(a.pauses).toEqual([FIXTURE_PAUSE]);
  });

  it('falls back to the legacy altitude field', async () => {
    const a = await parse(buildClimbDescentFit({ altitudeField: 'altitude' }));
    expect(a.points[0].altitude).toBeCloseTo(900, 0);
    expect(a.points[1000].altitude).toBeCloseTo(fixtureAltitude(1000), 0);
  });

  it('returns null altitude when no altitude field is present', async () => {
    const a = await parse(buildClimbDescentFit({ altitudeField: 'none' }));
    expect(a.points.every((p) => p.altitude === null)).toBe(true);
  });

  it('computes cumulative haversine distance when the device distance is missing', async () => {
    const a = await parse(buildClimbDescentFit({ includeDistance: false }));
    const last = a.points[a.points.length - 1];
    const expected = (3599 - 300) * FIXTURE_SPEED;
    expect(Math.abs(last.distance - expected) / expected).toBeLessThan(0.005);
    expect(a.points[0].distance).toBe(0);
  });

  it('uses 0 distance when there is neither device distance nor position', async () => {
    const a = await parse(buildClimbDescentFit({ includeDistance: false, includePositions: false }));
    expect(a.points.every((p) => p.distance === 0 && p.lat === null && p.lon === null)).toBe(true);
  });
});

describe('activityFromFitMessages (decoded messages)', () => {
  const ts = (s: number) => new Date(FIXTURE_START.getTime() + s * 1000);

  it('prefers enhancedAltitude over altitude, falling back per sample', () => {
    const messages: FitMessages = {
      recordMesgs: [
        { timestamp: ts(0), enhancedAltitude: 1000, altitude: 999 },
        { timestamp: ts(1), altitude: 1001 },
        { timestamp: ts(2) },
      ],
    };
    const a = activityFromFitMessages(messages, 'a.fit');
    expect(a.points.map((p) => p.altitude)).toEqual([1000, 1001, null]);
  });

  it('carries device distance forward over samples missing it', () => {
    const messages: FitMessages = {
      recordMesgs: [
        { timestamp: ts(0), distance: 0 },
        { timestamp: ts(1), distance: 3 },
        { timestamp: ts(2) },
        { timestamp: ts(3), distance: 9 },
      ],
    };
    expect(activityFromFitMessages(messages, 'a.fit').points.map((p) => p.distance)).toEqual([0, 3, 3, 9]);
  });

  it('collapses repeated stops and uses the sport message when there is no session', () => {
    const messages: FitMessages = {
      recordMesgs: [{ timestamp: ts(0) }, { timestamp: ts(100) }],
      eventMesgs: [
        { timestamp: ts(0), event: 'timer', eventType: 'start' },
        { timestamp: ts(10), event: 'timer', eventType: 'stop' },
        { timestamp: ts(12), event: 'timer', eventType: 'stopAll' },
        { timestamp: ts(20), event: 'timer', eventType: 'start' },
        { timestamp: ts(30), event: 'lap', eventType: 'stop' },
      ],
      sportMesgs: [{ sport: 'trailRunning' as never }],
    };
    const a = activityFromFitMessages(messages, 'a.fit');
    expect(a.pauses).toEqual([{ start: 10, end: 20 }]);
    expect(a.sport).toBe('trailRunning');
  });
});

describe('helpers', () => {
  it('semicirclesToDegrees', () => {
    expect(semicirclesToDegrees(2 ** 30)).toBe(90);
    expect(semicirclesToDegrees(-(2 ** 31))).toBe(-180);
    expect(semicirclesToDegrees(degreesToSemicircles(45.9237))).toBeCloseTo(45.9237, 7);
  });

  it('haversineMeters: one degree of latitude ≈ 111.2 km', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
  });

  it('activityNameFromFileName', () => {
    expect(activityNameFromFileName('Morning Run.fit')).toBe('Morning Run');
    expect(activityNameFromFileName('2024-07-13.trail.FIT')).toBe('2024-07-13.trail');
    expect(activityNameFromFileName('dir/sub/run.fit')).toBe('run');
    expect(activityNameFromFileName('noext')).toBe('noext');
  });
});

describe('parseFitFile – invalid input', () => {
  it('rejects an empty buffer', async () => {
    await expect(parseFitFile(new ArrayBuffer(0), 'empty.fit')).rejects.toThrow(/not a FIT file/);
  });

  it('rejects garbage bytes', async () => {
    const bytes = new Uint8Array(256).map((_, i) => (i * 37 + 11) & 0xff);
    await expect(parse(bytes, 'garbage.fit')).rejects.toThrow(/not a FIT file/);
  });

  it('rejects a non-FIT text file', async () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>');
    await expect(parse(bytes, 'track.gpx')).rejects.toThrow(/not a FIT file/);
  });

  it('rejects a FIT file with a corrupted payload (CRC error)', async () => {
    const bytes = buildClimbDescentFit();
    bytes[200] ^= 0xff;
    await expect(parse(bytes, 'corrupt.fit')).rejects.toThrow(/Failed to decode FIT file "corrupt.fit".*CRC/);
  });

  it('rejects a truncated FIT file', async () => {
    const bytes = buildClimbDescentFit().slice(0, 5000);
    await expect(parse(bytes, 'truncated.fit')).rejects.toThrow(/Failed to decode FIT file/);
  });

  it('rejects a valid FIT file with no record messages', async () => {
    const bytes = encodeActivity({ startTime: FIXTURE_START, records: [] });
    await expect(parse(bytes, 'empty-activity.fit')).rejects.toThrow(/no record messages/);
  });
});

describe('buildSampleFit', () => {
  it('is deterministic', () => {
    expect(buildSampleFit()).toEqual(buildSampleFit());
  });

  it('parses into an interesting ~18 km / ~1500 m D+ trail run with one pause', async () => {
    const a = await parse(buildSampleFit(), 'Demo trail run.fit');
    expect(a.name).toBe('Demo trail run');
    expect(a.sport).toBe('running');
    expect(a.startTime.toISOString()).toBe(SAMPLE_FIT_START.toISOString());

    const last = a.points[a.points.length - 1];
    expect(last.distance).toBeGreaterThan(15_000);
    expect(last.distance).toBeLessThan(20_000);

    // D+ on a lightly thresholded altitude series (ignore sensor jitter).
    let gain = 0;
    let ref = a.points[0].altitude!;
    for (const p of a.points) {
      const d = p.altitude! - ref;
      if (d > 5) { gain += d; ref = p.altitude!; }
      else if (d < -5) ref = p.altitude!;
    }
    expect(gain).toBeGreaterThan(1400);
    expect(gain).toBeLessThan(1700);

    expect(a.pauses).toHaveLength(1);
    expect(a.pauses[0].end - a.pauses[0].start).toBeGreaterThanOrEqual(200);
    expect(a.points.every((p) => p.lat !== null && p.lon !== null && p.heartRate !== null)).toBe(true);
    // 1 Hz outside the pause.
    const gaps = a.points.slice(1).map((p, i) => p.t - a.points[i].t);
    expect(gaps.filter((g) => g !== 1)).toHaveLength(1);
  });
});
