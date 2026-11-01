/**
 * FIT file bytes -> Activity.
 *
 * Browser-safe: only uses @garmin/fitsdk and plain JS (no Node APIs).
 */
import { Decoder, Stream, Utils } from '@garmin/fitsdk';
import type { EventMesg, FitMessages, RecordMesg } from '@garmin/fitsdk';
import type { Activity, DeviceTotals, PauseInterval, TrackPoint } from '../types';

/** Degrees per FIT semicircle (2^31 semicircles = 180 degrees). */
const DEG_PER_SEMICIRCLE = 180 / 2 ** 31;
const EARTH_RADIUS_M = 6_371_008.8;

/** Convert a FIT semicircle value to degrees. */
export function semicirclesToDegrees(semicircles: number): number {
  return semicircles * DEG_PER_SEMICIRCLE;
}

/** Great-circle distance in metres between two lat/lon points (degrees). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "Morning Run.fit" -> "Morning Run". Falls back to the raw name if stripping leaves nothing. */
export function activityNameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stripped = base.replace(/\.[^.]*$/, '').trim();
  return stripped || base.trim() || 'Activity';
}

/**
 * Parse a FIT file into an Activity.
 *
 * Throws an Error with a readable message if the data is not a FIT file, fails to decode
 * (including CRC errors / truncation), or contains no usable record messages.
 */
export async function parseFitFile(data: ArrayBuffer, fileName: string): Promise<Activity> {
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
    throw new Error(`"${fileName}" is empty or unreadable, not a FIT file.`);
  }

  const stream = Stream.fromArrayBuffer(data);
  if (!Decoder.isFIT(stream)) {
    throw new Error(`"${fileName}" is not a FIT file (missing ".FIT" header).`);
  }

  const decoder = new Decoder(stream);
  let messages: FitMessages;
  let errors: Error[];
  try {
    ({ messages, errors } = decoder.read({ convertDateTimesToDates: true, convertTypesToStrings: true }));
  } catch (err) {
    // read() normally catches internally and reports via `errors`; this is belt and braces.
    throw new Error(`Failed to decode FIT file "${fileName}": ${errorMessage(err)}`);
  }
  if (errors.length > 0) {
    const detail = errors.map(errorMessage).join('; ');
    const hint = /crc/i.test(detail) ? ' The file appears to be corrupted (CRC mismatch).' : '';
    throw new Error(`Failed to decode FIT file "${fileName}": ${detail}.${hint}`);
  }

  return activityFromFitMessages(messages, fileName);
}

/**
 * Build an Activity from already-decoded FIT messages (as returned by `Decoder.read()` with
 * default options). Exposed mainly for testing.
 */
export function activityFromFitMessages(messages: FitMessages, fileName: string): Activity {
  const records = (messages.recordMesgs ?? [])
    .map((r) => ({ r, time: toDate(r.timestamp) }))
    .filter((x): x is { r: RecordMesg; time: Date } => x.time !== null);

  if (records.length === 0) {
    throw new Error(`FIT file "${fileName}" contains no record messages (no track data).`);
  }

  // Devices write records in time order, but be defensive (stable sort keeps ties in file order).
  records.sort((a, b) => a.time.getTime() - b.time.getTime());

  const startMs = records[0].time.getTime();
  const points = buildPoints(records, startMs);
  const lastT = points[points.length - 1].t;

  return {
    name: activityNameFromFileName(fileName),
    sport: extractSport(messages),
    startTime: new Date(startMs),
    points,
    pauses: extractPauses(messages.eventMesgs ?? [], startMs, lastT),
    deviceTotals: extractDeviceTotals(messages),
  };
}

/**
 * Device-computed totals from the session message(s), summed over sessions (multisport files).
 * Each field is null when no session carries it; the whole object is null without any session.
 */
function extractDeviceTotals(messages: FitMessages): DeviceTotals | null {
  const sessions = messages.sessionMesgs ?? [];
  if (sessions.length === 0) return null;
  const sum = (values: unknown[]): number | null => {
    const nums = values.filter(isFiniteNumber);
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
  };
  return {
    totalAscent: sum(sessions.map((s) => s.totalAscent)),
    totalDescent: sum(sessions.map((s) => s.totalDescent)),
    totalDistance: sum(sessions.map((s) => s.totalDistance)),
    timerTime: sum(sessions.map((s) => s.totalTimerTime)),
    elapsedTime: sum(sessions.map((s) => s.totalElapsedTime)),
  };
}

function buildPoints(records: { r: RecordMesg; time: Date }[], startMs: number): TrackPoint[] {
  const hasDeviceDistance = records.some(({ r }) => isFiniteNumber(r.distance));

  const points: TrackPoint[] = [];
  let distance = 0;
  let prevLat: number | null = null;
  let prevLon: number | null = null;

  for (const { r, time } of records) {
    const lat = isFiniteNumber(r.positionLat) ? semicirclesToDegrees(r.positionLat) : null;
    const lon = isFiniteNumber(r.positionLong) ? semicirclesToDegrees(r.positionLong) : null;

    if (hasDeviceDistance) {
      // Device distance; samples missing it carry the last known value forward (0 before the first).
      if (isFiniteNumber(r.distance)) distance = r.distance;
    } else if (lat !== null && lon !== null) {
      // No device distance anywhere: cumulative haversine over consecutive fixes.
      // Gaps without a fix are bridged by the next fix. If there are no positions at all,
      // distance stays 0 for every point (documented fallback).
      if (prevLat !== null && prevLon !== null) distance += haversineMeters(prevLat, prevLon, lat, lon);
      prevLat = lat;
      prevLon = lon;
    }

    const altitude = isFiniteNumber(r.enhancedAltitude)
      ? r.enhancedAltitude
      : isFiniteNumber(r.altitude)
        ? r.altitude
        : null;

    points.push({
      t: (time.getTime() - startMs) / 1000,
      distance,
      altitude,
      lat,
      lon,
      heartRate: isFiniteNumber(r.heartRate) ? r.heartRate : null,
    });
  }
  return points;
}

/**
 * Pair timer stop/stopAll events with the following timer start.
 * Repeated stops while already stopped are ignored (the first one opens the pause);
 * an unmatched trailing stop (end of activity) is dropped.
 */
function extractPauses(events: EventMesg[], startMs: number, lastT: number): PauseInterval[] {
  const timerEvents = events
    .filter((e) => e.event === 'timer')
    .map((e) => ({ type: e.eventType, time: toDate(e.timestamp) }))
    .filter((e): e is { type: EventMesg['eventType']; time: Date } => e.time !== null)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  const pauses: PauseInterval[] = [];
  let stoppedAt: number | null = null;
  for (const e of timerEvents) {
    const t = (e.time.getTime() - startMs) / 1000;
    if (e.type === 'stop' || e.type === 'stopAll') {
      if (stoppedAt === null) stoppedAt = t;
    } else if (e.type === 'start') {
      if (stoppedAt !== null) {
        const start = Math.max(0, stoppedAt);
        const end = Math.min(t, lastT);
        if (end > start) pauses.push({ start, end });
        stoppedAt = null;
      }
    }
  }
  return pauses;
}

function extractSport(messages: FitMessages): string | null {
  const candidates = [
    ...(messages.sessionMesgs ?? []).map((s) => s.sport),
    ...(messages.sportMesgs ?? []).map((s) => s.sport),
  ];
  const sport = candidates.find((s) => s !== undefined && s !== null);
  return sport === undefined || sport === null ? null : String(sport);
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return Utils.convertDateTimeToDate(v);
  return null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
