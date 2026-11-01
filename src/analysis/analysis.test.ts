import { describe, expect, it } from 'vitest';
import { analyzeActivity } from './index';
import { DEFAULT_ANALYSIS_OPTIONS, type Activity, type AnalysisResult } from '../types';
import { buildActivity, median, rng } from './testUtils';

const opts = DEFAULT_ANALYSIS_OPTIONS;

/** Every number in the result is finite; segments partition the points. */
function checkInvariants(r: AnalysisResult) {
  const nums: number[] = [];
  for (const p of r.points) nums.push(p.movingTime, p.elapsedTime, p.distance, p.altitude, p.verticalSpeed, p.segmentIndex);
  for (const s of r.segments)
    nums.push(s.startIndex, s.endIndex, s.startDistance, s.endDistance, s.duration, s.gain, s.loss, s.avgVerticalSpeed, s.avgGrade);
  nums.push(...Object.values(r.summary));
  for (const x of nums) expect(Number.isFinite(x)).toBe(true);

  if (r.points.length === 0) {
    expect(r.segments).toHaveLength(0);
    return;
  }
  expect(r.segments[0].startIndex).toBe(0);
  expect(r.segments[r.segments.length - 1].endIndex).toBe(r.points.length - 1);
  for (let k = 0; k < r.segments.length; k++) {
    const s = r.segments[k];
    expect(s.endIndex).toBeGreaterThanOrEqual(s.startIndex);
    expect(s.gain).toBeGreaterThanOrEqual(0);
    expect(s.loss).toBeGreaterThanOrEqual(0);
    expect(s.duration).toBeGreaterThanOrEqual(0);
    if (k > 0) {
      expect(s.startIndex).toBe(r.segments[k - 1].endIndex + 1);
      expect(s.startDistance).toBe(r.segments[k - 1].endDistance);
      expect(s.direction).not.toBe(r.segments[k - 1].direction);
    }
    for (let i = s.startIndex; i <= s.endIndex; i++) expect(r.points[i].segmentIndex).toBe(k);
  }
  for (let i = 1; i < r.points.length; i++) {
    expect(r.points[i].movingTime).toBeGreaterThanOrEqual(r.points[i - 1].movingTime);
    expect(r.points[i].elapsedTime).toBeGreaterThan(r.points[i - 1].elapsedTime);
  }
  const dur = r.segments.reduce((a, s) => a + s.duration, 0);
  expect(dur).toBeCloseTo(r.summary.movingTime, 6);
}

function middleVam(r: AnalysisResult, from: number, to: number): number {
  return median(r.points.filter((p) => p.movingTime >= from && p.movingTime <= to).map((p) => p.verticalSpeed));
}

describe('analyzeActivity', () => {
  it('constant 1000 m/h climb -> ~1000 m/h VAM and a single up segment', () => {
    const r = analyzeActivity(buildActivity([{ durationSec: 3600, speedMps: 2, vamMph: 1000 }]), opts);
    checkInvariants(r);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].direction).toBe('up');
    expect(middleVam(r, 300, 3300)).toBeCloseTo(1000, 0);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(990);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1010);
    expect(r.summary.avgDescentSpeed).toBe(0);
    expect(r.summary.totalGain).toBeGreaterThan(990);
    expect(r.summary.movingTime).toBe(3600);
    expect(r.summary.totalDistance).toBe(7200);
  });

  it('climb then descent -> up + down', () => {
    const r = analyzeActivity(
      buildActivity([
        { durationSec: 1800, speedMps: 2, vamMph: 1000 },
        { durationSec: 1200, speedMps: 3, vamMph: -1500 },
      ]),
      opts,
    );
    checkInvariants(r);
    expect(r.segments.map((s) => s.direction)).toEqual(['up', 'down']);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(980);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1020);
    expect(r.summary.avgDescentSpeed).toBeLessThan(-1470);
    expect(r.summary.avgDescentSpeed).toBeGreaterThan(-1530);
    expect(Math.abs(r.segments[0].endDistance - 3600)).toBeLessThan(60);
    expect(middleVam(r, 2300, 2700)).toBeCloseTo(-1500, -1);
  });

  it('a gentle (sub-flatGrade) dip between climbs is flat: up, flat, up, down', () => {
    const r = analyzeActivity(
      buildActivity(
        [
          { durationSec: 1200, speedMps: 2, vamMph: 1000 },
          { durationSec: 1200, speedMps: 3, vamMph: -60 }, // -20 m over 3.6 km = -0.6 %
          { durationSec: 1200, speedMps: 2, vamMph: 1000 },
          { durationSec: 1200, speedMps: 3, vamMph: -1500 },
        ],
        { noiseM: 2, seed: 8 },
      ),
      opts,
    );
    checkInvariants(r);
    expect(r.segments.map((s) => s.direction)).toEqual(['up', 'flat', 'up', 'down']);
  });

  it('a flat valley floor and a flat finish become flat segments', () => {
    const r = analyzeActivity(
      buildActivity(
        [
          { durationSec: 1200, speedMps: 3, vamMph: -1500 },
          { durationSec: 1800, speedMps: 3, vamMph: 0 },
          { durationSec: 1800, speedMps: 2, vamMph: 1000 },
          { durationSec: 1200, speedMps: 3, vamMph: -1500 },
          { durationSec: 1800, speedMps: 3, vamMph: 0 },
        ],
        { noiseM: 3, seed: 12 },
      ),
      opts,
    );
    checkInvariants(r);
    expect(r.segments.map((s) => s.direction)).toEqual(['down', 'flat', 'up', 'down', 'flat']);
    const valley = r.segments[1];
    expect(Math.abs(valley.startDistance - 3600)).toBeLessThan(150);
    expect(Math.abs(valley.endDistance - 9000)).toBeLessThan(150);
    expect(r.summary.avgDescentSpeed).toBeLessThan(-1400);
  });

  it('a short rounded summit / valley does not become a flat sliver; boundaries sit on the extremes', () => {
    // Climb, ~1.5 min rounded top (gentle up then gentle down), descent, ~1.5 min rounded valley, climb.
    const r = analyzeActivity(
      buildActivity(
        [
          { durationSec: 1800, speedMps: 1.5, vamMph: 1000 },
          { durationSec: 45, speedMps: 3, vamMph: 150 },
          { durationSec: 45, speedMps: 3, vamMph: -150 },
          { durationSec: 1200, speedMps: 3, vamMph: -1400 },
          { durationSec: 45, speedMps: 3, vamMph: -150 },
          { durationSec: 45, speedMps: 3, vamMph: 150 },
          { durationSec: 1200, speedMps: 1.5, vamMph: 1000 },
        ],
        { noiseM: 1, seed: 21 },
      ),
      opts,
    );
    checkInvariants(r);
    expect(r.segments.map((s) => s.direction)).toEqual(['up', 'down', 'up']);
    const alts = r.points.map((p) => p.altitude);
    // Climb ends at the summit sample; descent ends at the valley sample.
    const summit = r.segments[1].startIndex;
    const valley = r.segments[2].startIndex;
    expect(alts[summit]).toBe(Math.max(...alts.slice(0, valley)));
    expect(alts[valley]).toBe(Math.min(...alts.slice(summit)));
  });

  it('±3 m jitter below the threshold does not create extra segments', () => {
    const climb = analyzeActivity(buildActivity([{ durationSec: 3600, speedMps: 2, vamMph: 1000 }], { noiseM: 3, seed: 7 }), opts);
    checkInvariants(climb);
    expect(climb.segments.map((s) => s.direction)).toEqual(['up']);
    expect(climb.summary.avgClimbSpeed).toBeGreaterThan(980);
    expect(climb.summary.avgClimbSpeed).toBeLessThan(1020);

    const flat = analyzeActivity(buildActivity([{ durationSec: 3600, speedMps: 3, vamMph: 0 }], { noiseM: 3, seed: 9 }), opts);
    checkInvariants(flat);
    expect(flat.segments.map((s) => s.direction)).toEqual(['flat']);

    const updown = analyzeActivity(
      buildActivity(
        [
          { durationSec: 1800, speedMps: 2, vamMph: 1000 },
          { durationSec: 1200, speedMps: 3, vamMph: -1500 },
        ],
        { noiseM: 3, seed: 11 },
      ),
      opts,
    );
    expect(updown.segments.map((s) => s.direction)).toEqual(['up', 'down']);
  });

  it('a 10-minute timer pause does not affect avg VAM or moving time', () => {
    const a = buildActivity([
      { durationSec: 1800, speedMps: 2, vamMph: 1000 },
      { durationSec: 600, speedMps: 0, vamMph: 0, paused: true },
      { durationSec: 1800, speedMps: 2, vamMph: 1000 },
    ]);
    const r = analyzeActivity(a, opts);
    checkInvariants(r);
    expect(r.summary.elapsedTime).toBe(4200);
    expect(r.summary.movingTime).toBe(3600);
    expect(r.segments.map((s) => s.direction)).toEqual(['up']);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(990);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1010);
    expect(middleVam(r, 1700, 1900)).toBeCloseTo(1000, -1);
  });

  it('pause boundaries jittered past the resume sample: gap excluded, no negative durations', () => {
    const a = buildActivity([
      { durationSec: 1800, speedMps: 2, vamMph: 1000 },
      { durationSec: 600, speedMps: 0, vamMph: 0, paused: true },
      { durationSec: 1800, speedMps: 2, vamMph: 1000 },
    ]);
    // Samples at ...1800 then 2401, 2402...; the device reports the pause starting 0.3 s before the
    // last sample and ending 0.4 s AFTER the first sample written on resume.
    a.pauses = [{ start: 1799.7, end: 2401.4 }];
    const r = analyzeActivity(a, opts);
    checkInvariants(r);
    // The whole 601 s gap is excluded, nothing more: the interval after the resume sample keeps its 1 s.
    expect(r.summary.movingTime).toBeCloseTo(4200 - 601, 6);
    const i = r.points.findIndex((p) => p.elapsedTime === 2402);
    expect(r.points[i].movingTime - r.points[i - 1].movingTime).toBeCloseTo(1, 6);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(990);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1010);
  });

  it('a 10-minute stationary stop (timer running) does not dilute avg VAM', () => {
    const a = buildActivity(
      [
        { durationSec: 1800, speedMps: 2, vamMph: 1000 },
        { durationSec: 600, speedMps: 0, vamMph: 0 },
        { durationSec: 1800, speedMps: 2, vamMph: 1000 },
      ],
      { noiseM: 1, seed: 3 },
    );
    const r = analyzeActivity(a, opts);
    checkInvariants(r);
    expect(r.summary.elapsedTime).toBe(4200);
    expect(r.summary.movingTime).toBeGreaterThan(3600);
    expect(r.summary.movingTime).toBeLessThan(3600 + 60);
    expect(r.segments.map((s) => s.direction)).toEqual(['up']);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(975);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1015);
  });

  it('slow steep power-hiking is not classified as stationary', () => {
    const r = analyzeActivity(
      buildActivity([
        { durationSec: 600, speedMps: 2, vamMph: 600 },
        { durationSec: 1200, speedMps: 0.2, vamMph: 700 },
        { durationSec: 600, speedMps: 2, vamMph: 600 },
      ], { noiseM: 2, seed: 5 }),
      opts,
    );
    checkInvariants(r);
    expect(r.summary.movingTime).toBe(r.summary.elapsedTime);
    expect(middleVam(r, 900, 1500)).toBeCloseTo(700, -1);
  });

  it('handles irregular sampling (smart recording)', () => {
    const rand = rng(42);
    const a = buildActivity(
      [
        { durationSec: 2400, speedMps: 2, vamMph: 1000 },
        { durationSec: 600, speedMps: 0, vamMph: 0 },
        { durationSec: 1800, speedMps: 3, vamMph: -1200 },
      ],
      { dt: () => 1 + Math.floor(rand() * 10), noiseM: 2, seed: 4 },
    );
    const r = analyzeActivity(a, opts);
    checkInvariants(r);
    expect(r.segments.map((s) => s.direction)).toEqual(['up', 'down']);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(970);
    expect(r.summary.avgClimbSpeed).toBeLessThan(1030);
    expect(r.summary.avgDescentSpeed).toBeLessThan(-1150);
    expect(r.summary.avgDescentSpeed).toBeGreaterThan(-1250);
    expect(r.summary.movingTime).toBeLessThan(4200 + 60);
    expect(middleVam(r, 600, 1800)).toBeCloseTo(1000, -2);
  });

  it('one sample at each end of a long stop (sparse smart recording) is still a stop', () => {
    const a = buildActivity([{ durationSec: 1800, speedMps: 2, vamMph: 1000 }]);
    const last = a.points[a.points.length - 1];
    const after = buildActivity([{ durationSec: 1800, speedMps: 2, vamMph: 1000 }], { startAltitude: last.altitude! }).points.map(
      (p) => ({ ...p, t: p.t + last.t + 600, distance: p.distance + last.distance }),
    );
    a.points.push(...after);
    const r = analyzeActivity(a, opts);
    checkInvariants(r);
    expect(r.summary.movingTime).toBe(3600);
    expect(r.summary.avgClimbSpeed).toBeGreaterThan(990);
  });

  describe('edge cases (no NaN / Infinity anywhere)', () => {
    const base = (points: Activity['points'], pauses: Activity['pauses'] = []): Activity => ({
      name: 'x',
      sport: null,
      startTime: new Date(0),
      points,
      pauses,
      deviceTotals: null,
    });
    const pt = (t: number, distance: number, altitude: number | null) => ({ t, distance, altitude, lat: null, lon: null, heartRate: null });

    it('empty activity', () => {
      const r = analyzeActivity(base([]), opts);
      expect(r.points).toEqual([]);
      expect(r.segments).toEqual([]);
      checkInvariants(r);
    });

    it('single point', () => {
      const r = analyzeActivity(base([pt(0, 0, 500)]), opts);
      checkInvariants(r);
      expect(r.segments).toHaveLength(1);
      expect(r.points[0].altitude).toBe(500);
    });

    it('no altitude at all throws a clear error', () => {
      expect(() => analyzeActivity(base([pt(0, 0, null), pt(1, 2, null)]), opts)).toThrow(/no altitude/i);
    });

    it('duplicate / unsorted timestamps and zero duration', () => {
      const r = analyzeActivity(base([pt(5, 10, 100), pt(0, 0, 100), pt(0, 0, 101), pt(5, 10, 102)]), opts);
      checkInvariants(r);
      expect(r.points.map((p) => p.elapsedTime)).toEqual([0, 5]);
      const z = analyzeActivity(base([pt(3, 0, 100), pt(3, 0, 200)]), opts);
      checkInvariants(z);
    });

    it('all-flat, all-stationary, zero windows and zero threshold', () => {
      const flat = buildActivity([{ durationSec: 600, speedMps: 0, vamMph: 0 }]);
      const r = analyzeActivity(flat, opts);
      checkInvariants(r);
      expect(r.summary.movingTime).toBe(0);
      expect(r.segments.map((s) => s.direction)).toEqual(['flat']);
      const zero = { smoothingWindowSec: 0, segmentThresholdM: 0, flatGradePct: 0, verticalSpeedWindowSec: 0 };
      checkInvariants(analyzeActivity(buildActivity([{ durationSec: 300, speedMps: 2, vamMph: 800 }], { noiseM: 2 }), zero));
      checkInvariants(analyzeActivity(flat, zero));
    });

    it('altitude gaps: short ones interpolated, long ones and leading nulls dropped', () => {
      const pts = [pt(0, 0, null), pt(1, 1, 100), pt(2, 2, null), pt(3, 3, 104), pt(4, 4, null), pt(500, 500, 110), pt(501, 501, 111)];
      const r = analyzeActivity(base(pts), { ...opts, smoothingWindowSec: 0 });
      checkInvariants(r);
      expect(r.points.map((p) => p.elapsedTime)).toEqual([1, 2, 3, 500, 501]);
      expect(r.points[1].altitude).toBe(102);
    });

    it('pauses that overlap, are unsorted, or are invalid', () => {
      const a = buildActivity([{ durationSec: 1000, speedMps: 2, vamMph: 900 }]);
      a.pauses = [
        { start: 500, end: 600 },
        { start: 100, end: 200 },
        { start: 150, end: 250 },
        { start: 900, end: 800 },
        { start: NaN, end: 10 },
      ];
      const r = analyzeActivity(a, opts);
      checkInvariants(r);
      expect(r.summary.movingTime).toBeCloseTo(1000 - 150 - 100, 6);
    });
  });

  describe('device totals', () => {
    const legs = [
      { durationSec: 1800, speedMps: 2, vamMph: 1000 },
      { durationSec: 600, speedMps: 0, vamMph: 0, paused: true },
      { durationSec: 1200, speedMps: 3, vamMph: -1500 },
    ];

    it('summary uses device ascent/descent/distance/elapsed; movingTime, segments and speeds stay computed', () => {
      const computed = analyzeActivity(buildActivity(legs, { noiseM: 2, seed: 30 }), opts);
      const a = buildActivity(legs, { noiseM: 2, seed: 30 });
      a.deviceTotals = { totalAscent: 512, totalDescent: 498, totalDistance: 7250, timerTime: 3000, elapsedTime: 3601 };
      const r = analyzeActivity(a, opts);
      checkInvariants(r);
      expect(r.summary.totalGain).toBe(512);
      expect(r.summary.totalLoss).toBe(498);
      expect(r.summary.totalDistance).toBe(7250);
      expect(r.summary.elapsedTime).toBe(3601);
      expect(r.summary.movingTime).toBe(computed.summary.movingTime);
      expect(r.summary.avgClimbSpeed).toBe(computed.summary.avgClimbSpeed);
      expect(r.summary.avgDescentSpeed).toBe(computed.summary.avgDescentSpeed);
      expect(r.segments).toEqual(computed.segments);
      expect(r.points).toEqual(computed.points);
    });

    it('device totals do not change with the smoothing setting', () => {
      const a = buildActivity(legs, { noiseM: 3, seed: 31 });
      a.deviceTotals = { totalAscent: 500, totalDescent: 500, totalDistance: null, timerTime: null, elapsedTime: null };
      for (const w of [5, 30, 120]) {
        const r = analyzeActivity(a, { ...opts, smoothingWindowSec: w });
        expect(r.summary.totalGain).toBe(500);
        expect(r.summary.totalLoss).toBe(500);
      }
    });

    it('falls back per field to computed values when null (or deviceTotals is null)', () => {
      const computed = analyzeActivity(buildActivity(legs), opts).summary;
      const a = buildActivity(legs);
      a.deviceTotals = { totalAscent: 505, totalDescent: null, totalDistance: null, timerTime: null, elapsedTime: null };
      const r = analyzeActivity(a, opts).summary;
      expect(r.totalGain).toBe(505);
      expect(r.totalLoss).toBe(computed.totalLoss);
      expect(r.totalDistance).toBe(computed.totalDistance);
      expect(r.elapsedTime).toBe(computed.elapsedTime);
      expect(computed.totalDistance).toBe(7200);
      expect(computed.elapsedTime).toBe(3600);
      expect(computed.totalGain).toBeGreaterThan(495);
      expect(computed.totalLoss).toBeGreaterThan(495);
    });

    it('applies to an empty activity too', () => {
      const r = analyzeActivity(
        {
          name: 'x',
          sport: null,
          startTime: new Date(0),
          points: [],
          pauses: [],
          deviceTotals: { totalAscent: 10, totalDescent: 12, totalDistance: 100, timerTime: 60, elapsedTime: 70 },
        },
        opts,
      );
      expect(r.summary).toMatchObject({ totalGain: 10, totalLoss: 12, totalDistance: 100, elapsedTime: 70, movingTime: 0 });
    });
  });

  it('performance: 30k points (10 h at ~1 Hz) in under 200 ms', () => {
    const legs = [];
    for (let k = 0; k < 10; k++) {
      legs.push({ durationSec: 1800, speedMps: 2, vamMph: 900 });
      legs.push({ durationSec: 1200, speedMps: 3, vamMph: -1300 });
    }
    legs.push({ durationSec: 6000, speedMps: 3, vamMph: 0 });
    const a = buildActivity(legs, { noiseM: 3, seed: 2 });
    expect(a.points.length).toBeGreaterThanOrEqual(30000);
    analyzeActivity(a, opts); // warm-up (JIT)
    const t0 = performance.now();
    const r = analyzeActivity(a, opts);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    expect(r.segments.filter((s) => s.direction === 'up')).toHaveLength(10);
    expect(r.segments.filter((s) => s.direction === 'down')).toHaveLength(10);
    expect(r.segments[r.segments.length - 1].direction).toBe('flat');
    checkInvariants(r);
  });
});
