/** Display formatting. All inputs are SI (metres, seconds) or m/h / percent as noted. */

const MINUS = '−';
const DASH = '–';

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function finite(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Integer with thousands separators and a typographic minus: -1234.4 -> "−1,234". */
export function formatInt(n: number): string {
  if (!finite(n)) return DASH;
  const r = Math.round(n);
  const s = intFmt.format(Math.abs(r));
  return r < 0 ? MINUS + s : s;
}

/** Seconds -> "h:mm:ss" (hours not padded, may exceed 24). */
export function formatDuration(sec: number): string {
  if (!finite(sec) || sec < 0) return DASH;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Seconds -> "h:mm" for axis labels. */
export function formatClock(sec: number): string {
  if (!finite(sec) || sec < 0) return DASH;
  const totalMin = Math.round(sec / 60);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}

/** Metres -> "12.34 km". */
export function formatKm(m: number, digits = 2): string {
  if (!finite(m)) return DASH;
  return `${(m / 1000).toFixed(digits)} km`;
}

/** Metres -> "1,234 m". */
export function formatElevation(m: number): string {
  if (!finite(m)) return DASH;
  return `${formatInt(m)} m`;
}

/** m/h -> "+732 m/h" / "−1,105 m/h" / "0 m/h". */
export function formatVerticalSpeed(mh: number): string {
  if (!finite(mh)) return DASH;
  const r = Math.round(mh);
  return `${r > 0 ? '+' : ''}${formatInt(r)} m/h`;
}

/** Percent -> "+12.3%" / "−4.0%". */
export function formatGrade(pct: number, digits = 1): string {
  if (!finite(pct)) return DASH;
  const s = Math.abs(pct).toFixed(digits);
  if (Number(s) === 0) return `${s}%`;
  return `${pct > 0 ? '+' : MINUS}${s}%`;
}

/** Direction label for UI. */
export function directionLabel(d: 'up' | 'down' | 'flat'): string {
  return d === 'up' ? 'Climb' : d === 'down' ? 'Descent' : 'Flat';
}
