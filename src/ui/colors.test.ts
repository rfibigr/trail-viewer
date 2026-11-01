import { describe, expect, it } from 'vitest';
import {
  CLIMB_MAX,
  CLIMB_STOPS,
  DESCENT_MAX,
  DESCENT_STOPS,
  NEUTRAL,
  cssScaleGradient,
  hexToRgb,
  mixOklab,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  sampleStops,
  scalePosition,
  scaleStops,
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
    for (const s of DESCENT_STOPS) expect(verticalSpeedColor(s.value)).toBe(s.color);
  });

  it('is the theme neutral at exactly zero', () => {
    expect(verticalSpeedColor(0, 'light')).toBe(NEUTRAL.light);
    expect(verticalSpeedColor(0, 'dark')).toBe(NEUTRAL.dark);
  });

  it('is continuous across zero (no hue flip between tiny climbs and tiny descents)', () => {
    const up = rgbToOklab(hexToRgb(verticalSpeedColor(5)));
    const down = rgbToOklab(hexToRgb(verticalSpeedColor(-5)));
    const dE = Math.hypot(up[0] - down[0], up[1] - down[1], up[2] - down[2]);
    expect(dE).toBeLessThan(0.02);
  });

  it('is continuous everywhere: small speed steps give small colour steps', () => {
    let prev = rgbToOklab(hexToRgb(verticalSpeedColor(-3000)));
    for (let v = -3000; v <= 2000; v += 10) {
      const c = rgbToOklab(hexToRgb(verticalSpeedColor(v)));
      expect(Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2])).toBeLessThan(0.03);
      prev = c;
    }
  });

  it('clamps beyond the ends', () => {
    expect(verticalSpeedColor(5000)).toBe(CLIMB_STOPS[CLIMB_STOPS.length - 1].color);
    expect(verticalSpeedColor(-9000)).toBe(DESCENT_STOPS[DESCENT_STOPS.length - 1].color);
  });

  it('handles non-finite input without throwing', () => {
    expect(verticalSpeedColor(NaN)).toBe(NEUTRAL.light);
    expect(verticalSpeedColor(Infinity, 'dark')).toBe(NEUTRAL.dark);
  });

  it('gets monotonically darker with |speed| beyond the pale first stops', () => {
    let prev = Infinity;
    for (let v = CLIMB_STOPS[0].value; v <= 1600; v += 25) {
      const L = lightness(verticalSpeedColor(v));
      expect(L).toBeLessThanOrEqual(prev + 1e-3);
      prev = L;
    }
    prev = Infinity;
    for (let v = DESCENT_STOPS[0].value; v >= -2600; v -= 25) {
      const L = lightness(verticalSpeedColor(v));
      expect(L).toBeLessThanOrEqual(prev + 1e-3);
      prev = L;
    }
  });

  it('a steeper bit inside a climb is visibly darker', () => {
    expect(lightness(verticalSpeedColor(800)) - lightness(verticalSpeedColor(1100))).toBeGreaterThan(0.05);
  });

  it('climbs are warm (a+b>0), descents are cool (b<0)', () => {
    for (const v of [400, 800, 1200, 1500]) {
      const [, a, b] = rgbToOklab(hexToRgb(verticalSpeedColor(v)));
      expect(a + b).toBeGreaterThan(0);
    }
    for (const v of [-600, -1200, -2000, -2500]) {
      const [, , b] = rgbToOklab(hexToRgb(verticalSpeedColor(v)));
      expect(b).toBeLessThan(0);
    }
  });

  it('interpolates between stops in OKLab', () => {
    const mid = (CLIMB_STOPS[1].value + CLIMB_STOPS[2].value) / 2;
    expect(verticalSpeedColor(mid)).toBe(mixOklab(CLIMB_STOPS[1].color, CLIMB_STOPS[2].color, 0.5));
  });
});

describe('sampleStops / scaleStops', () => {
  it('scale is sorted ascending with neutral at 0', () => {
    const s = scaleStops('dark');
    for (let i = 1; i < s.length; i++) expect(s[i].value).toBeGreaterThan(s[i - 1].value);
    expect(s.find((x) => x.value === 0)?.color).toBe(NEUTRAL.dark);
  });
  it('sampleStops clamps', () => {
    const s = scaleStops();
    expect(sampleStops(s, -1e9)).toBe(s[0].color);
    expect(sampleStops(s, 1e9)).toBe(s[s.length - 1].color);
  });
});

describe('segmentColor', () => {
  it('uses theme neutral for flat segments, regardless of speed', () => {
    expect(segmentColor({ direction: 'flat', avgVerticalSpeed: 900 }, 'light')).toBe(NEUTRAL.light);
    expect(segmentColor({ direction: 'flat', avgVerticalSpeed: -900 }, 'dark')).toBe(NEUTRAL.dark);
  });
  it('uses the vertical speed scale otherwise', () => {
    expect(segmentColor({ direction: 'up', avgVerticalSpeed: 1000 })).toBe(verticalSpeedColor(1000));
    expect(segmentColor({ direction: 'down', avgVerticalSpeed: -1850 })).toBe(verticalSpeedColor(-1850));
  });
});

describe('legend helpers', () => {
  it('cssScaleGradient runs from the descent end to the climb end', () => {
    const g = cssScaleGradient('light', 8);
    expect(g.startsWith(`linear-gradient(to right, ${DESCENT_STOPS[DESCENT_STOPS.length - 1].color} 0.0%`)).toBe(true);
    expect(g.endsWith(`${CLIMB_STOPS[CLIMB_STOPS.length - 1].color} 100.0%)`)).toBe(true);
  });
  it('scalePosition maps the ends and zero', () => {
    expect(scalePosition(DESCENT_MAX)).toBe(0);
    expect(scalePosition(CLIMB_MAX)).toBe(1);
    expect(scalePosition(0)).toBeCloseTo(-DESCENT_MAX / (CLIMB_MAX - DESCENT_MAX));
    expect(scalePosition(99999)).toBe(1);
  });
});
