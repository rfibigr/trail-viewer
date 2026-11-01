/**
 * Colour mapping for vertical speed (m/h).
 *
 * One continuous diverging scale with a neutral grey at 0 m/h:
 *   descents (cool): deep indigo <- blue <- pale cyan <- neutral
 *   climbs   (warm): neutral -> pale yellow -> orange -> red -> deep crimson
 * Crossing zero therefore passes through grey instead of flipping hue.
 * Interpolation happens in OKLab so steps look perceptually even; values beyond the
 * end stops are clamped.
 */
import type { Direction } from '../types';

export interface ColorStop {
  /** Vertical speed in m/h. */
  value: number;
  /** sRGB hex colour, '#rrggbb'. */
  color: string;
}

export type Theme = 'light' | 'dark';

/** Colour at 0 m/h (and for 'flat' segments). Darker in dark mode so flat ground stays recessive. */
export const NEUTRAL: Record<Theme, string> = {
  light: '#d5d4cf',
  dark: '#7d828c',
};

/** Climb arm, ascending, excluding the neutral 0 stop. Clamps at 1500 m/h. */
export const CLIMB_STOPS: readonly ColorStop[] = [
  { value: 150, color: '#fdeb9a' },
  { value: 400, color: '#fdcb5c' },
  { value: 700, color: '#fb9b38' },
  { value: 1000, color: '#e8532a' },
  { value: 1250, color: '#c21f2a' },
  { value: 1500, color: '#7a0b22' },
];

/** Descent arm, by increasing magnitude, excluding the neutral 0 stop. Clamps at -2500 m/h. */
export const DESCENT_STOPS: readonly ColorStop[] = [
  { value: -200, color: '#c4ebf3' },
  { value: -600, color: '#86cbe4' },
  { value: -1200, color: '#4392d3' },
  { value: -1850, color: '#2f55b5' },
  { value: -2500, color: '#2a1a74' },
];

export const CLIMB_MAX = CLIMB_STOPS[CLIMB_STOPS.length - 1].value;
export const DESCENT_MAX = DESCENT_STOPS[DESCENT_STOPS.length - 1].value;

/** Full scale for a theme, sorted by ascending value (DESCENT_MAX .. 0 .. CLIMB_MAX). */
export function scaleStops(theme: Theme = 'light'): ColorStop[] {
  return [...DESCENT_STOPS].reverse().concat([{ value: 0, color: NEUTRAL[theme] }], CLIMB_STOPS);
}

const scaleCache: Partial<Record<Theme, ColorStop[]>> = {};

// ---------------------------------------------------------------------------
// Colour-space helpers (sRGB <-> OKLab)

type Vec3 = [number, number, number];

export function hexToRgb(hex: string): Vec3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Vec3): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

export function rgbToOklab(rgb: Vec3): Vec3 {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Interpolate two hex colours in OKLab; t in [0, 1]. */
export function mixOklab(from: string, to: string, t: number): string {
  const a = rgbToOklab(hexToRgb(from));
  const b = rgbToOklab(hexToRgb(to));
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex(oklabToRgb([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]));
}

/** Sample stops sorted by ascending value at v, interpolating in OKLab and clamping at both ends. */
export function sampleStops(stops: readonly ColorStop[], v: number): string {
  if (!(v > stops[0].value)) return stops[0].color; // also catches NaN
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i].value;
    if (v <= hi) {
      const lo = stops[i - 1].value;
      return mixOklab(stops[i - 1].color, stops[i].color, (v - lo) / (hi - lo));
    }
  }
  return stops[stops.length - 1].color;
}

/** Continuous colour for a vertical speed in m/h (positive = climbing). Non-finite input -> neutral. */
export function verticalSpeedColor(vs: number, theme: Theme = 'light'): string {
  if (!Number.isFinite(vs)) return NEUTRAL[theme];
  const stops = (scaleCache[theme] ??= scaleStops(theme));
  return sampleStops(stops, vs);
}

/** Colour for a segment: flat segments are neutral grey, others follow their average vertical speed. */
export function segmentColor(
  segment: { direction: Direction; avgVerticalSpeed: number },
  theme: Theme = 'light',
): string {
  if (segment.direction === 'flat') return NEUTRAL[theme];
  return verticalSpeedColor(segment.avgVerticalSpeed, theme);
}

/** CSS linear-gradient for the whole scale (DESCENT_MAX on the left, CLIMB_MAX on the right), sampled in OKLab. */
export function cssScaleGradient(theme: Theme = 'light', samples = 40): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = DESCENT_MAX + ((CLIMB_MAX - DESCENT_MAX) * i) / samples;
    parts.push(`${verticalSpeedColor(v, theme)} ${((i / samples) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Position (0..1) of a vertical speed along the legend bar. */
export function scalePosition(vs: number): number {
  return Math.min(1, Math.max(0, (vs - DESCENT_MAX) / (CLIMB_MAX - DESCENT_MAX)));
}
