import { describe, expect, it } from 'vitest';
import {
  CLIMB_STOPS,
  DESCENT_STOPS,
  FLAT_COLOR,
  cssGradient,
  hexToRgb,
  mixOklab,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  sampleStops,
  segmentColor,
  verticalSpeedColor,
} from './colors';

const lightness = (hex: string) => rgbToOklab(hexToRgb(hex))[0];

describe('hex / oklab helpers', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#1a2B3c'))).toBe('#1a2b3c');
    expect(() => hexToRgb('red')).toThrow();
  });

  it('round-trips through OKLab', () => {
    for (const hex of ['#000000', '#ffffff', '#fb9b38', '#2a1a74', '#7a0b22']) {
      expect(rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))))).toBe(hex);
    }
  });

  it('white has L=1, black L=0', () => {
    expect(lightness('#ffffff')).toBeCloseTo(1, 4);
    expect(lightness('#000000')).toBeCloseTo(0, 4);
  });

  it('mixOklab hits endpoints and clamps t', () => {
    expect(mixOklab('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixOklab('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    expect(mixOklab('#ff0000', '#0000ff', -3)).toBe('#ff0000');
    expect(mixOklab('#ff0000', '#0000ff', 9)).toBe('#0000ff');
  });

  it('mixOklab midpoint of black/white is perceptual mid-grey, not sRGB #808080', () => {
    const mid = mixOklab('#000000', '#ffffff', 0.5);
    expect(lightness(mid)).toBeCloseTo(0.5, 2);
    expect(mid).not.toBe('#808080');
  });
});

describe('verticalSpeedColor', () => {
  it('returns exact stop colours at stop values', () => {
    for (const s of CLIMB_STOPS) expect(verticalSpeedColor(s.value)).toBe(s.color);
    for (const s of DESCENT_STOPS.slice(1)) expect(verticalSpeedColor(s.value)).toBe(s.color);
  });

  it('clamps beyond the ends', () => {
    expect(verticalSpeedColor(5000)).toBe(CLIMB_STOPS[CLIMB_STOPS.length - 1].color);
    expect(verticalSpeedColor(-9000)).toBe(DESCENT_STOPS[DESCENT_STOPS.length - 1].color);
  });

  it('zero maps to the pale climb end; tiny negatives to the pale descent end', () => {
    expect(verticalSpeedColor(0)).toBe(CLIMB_STOPS[0].color);
    expect(verticalSpeedColor(-1e-9)).toBe(DESCENT_STOPS[0].color);
  });

  it('handles non-finite input without throwing', () => {
    expect(verticalSpeedColor(NaN)).toBe(CLIMB_STOPS[0].color);
    expect(verticalSpeedColor(Infinity)).toBe(CLIMB_STOPS[0].color);
  });

  it('gets monotonically darker with |speed| on both scales', () => {
    let prev = Infinity;
    for (let v = 0; v <= 1600; v += 50) {
      const L = lightness(verticalSpeedColor(v));
      expect(L).toBeLessThanOrEqual(prev + 1e-3);
      prev = L;
    }
    prev = Infinity;
    for (let v = 0; v >= -2600; v -= 50) {
      const L = lightness(verticalSpeedColor(v - 1e-6));
      expect(L).toBeLessThanOrEqual(prev + 1e-3);
      prev = L;
    }
  });

  it('climbs are warm (a>0 or b>0), descents are cool (b<0)', () => {
    for (const v of [400, 800, 1200, 1500]) {
      const [, a, b] = rgbToOklab(hexToRgb(verticalSpeedColor(v)));
      expect(a + b).toBeGreaterThan(0);
    }
    for (const v of [-600, -1200, -2000, -2500]) {
      const [, , b] = rgbToOklab(hexToRgb(verticalSpeedColor(v)));
      expect(b).toBeLessThan(0);
    }
  });

  it('interpolates between stops', () => {
    const c = verticalSpeedColor(475); // between 300 and 650
    expect(c).not.toBe(CLIMB_STOPS[1].color);
    expect(c).not.toBe(CLIMB_STOPS[2].color);
    expect(c).toBe(mixOklab(CLIMB_STOPS[1].color, CLIMB_STOPS[2].color, 0.5));
  });
});

describe('sampleStops', () => {
  it('works with |value| regardless of sign', () => {
    expect(sampleStops(DESCENT_STOPS, 1100)).toBe(sampleStops(DESCENT_STOPS, -1100));
  });
});

describe('segmentColor', () => {
  it('uses theme grey for flat segments, regardless of speed', () => {
    expect(segmentColor({ direction: 'flat', avgVerticalSpeed: 900 }, 'light')).toBe(FLAT_COLOR.light);
    expect(segmentColor({ direction: 'flat', avgVerticalSpeed: -900 }, 'dark')).toBe(FLAT_COLOR.dark);
  });
  it('uses the vertical speed scale otherwise', () => {
    expect(segmentColor({ direction: 'up', avgVerticalSpeed: 1000 })).toBe(verticalSpeedColor(1000));
    expect(segmentColor({ direction: 'down', avgVerticalSpeed: -1800 })).toBe(verticalSpeedColor(-1800));
  });
});

describe('cssGradient', () => {
  it('starts and ends on the scale endpoints', () => {
    const g = cssGradient(CLIMB_STOPS, 'to right', 4);
    expect(g.startsWith('linear-gradient(to right, #fff3b0 0.0%')).toBe(true);
    expect(g.endsWith(`${CLIMB_STOPS[CLIMB_STOPS.length - 1].color} 100.0%)`)).toBe(true);
  });
});
