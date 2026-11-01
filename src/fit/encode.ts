/**
 * Small helper around the SDK Encoder to build activity FIT files in memory.
 * Used by the demo activity (sampleFit.ts) and by tests. Browser-safe.
 */
import { Encoder, Profile } from '@garmin/fitsdk';
import type { ActivityMesg, EventMesg, FileIdMesg, RecordMesg, SessionMesg } from '@garmin/fitsdk';

const SEMICIRCLES_PER_DEG = 2 ** 31 / 180;

export function degreesToSemicircles(deg: number): number {
  return Math.round(deg * SEMICIRCLES_PER_DEG);
}

export interface EncodeRecord {
  /** Seconds since `startTime`. Whole seconds (FIT timestamps have 1 s resolution). */
  t: number;
  lat?: number;
  lon?: number;
  /** Written as the record's enhancedAltitude field. */
  enhancedAltitude?: number;
  /** Written as the record's legacy altitude field (the decoder also expands it to enhancedAltitude). */
  altitude?: number;
  distance?: number;
  heartRate?: number;
}

export interface EncodeTimerEvent {
  t: number;
  eventType: 'start' | 'stop' | 'stopAll';
}

export interface EncodeActivityInput {
  startTime: Date;
  records: EncodeRecord[];
  timerEvents?: EncodeTimerEvent[];
  /** e.g. 'running'. Omit to write no session message. */
  sport?: string;
  subSport?: string;
}

export function encodeActivity(input: EncodeActivityInput): Uint8Array {
  const { startTime, records, timerEvents = [] } = input;
  const at = (t: number) => new Date(startTime.getTime() + Math.round(t) * 1000);
  const enc = new Encoder();

  enc.onMesg(Profile.MesgNum.FILE_ID, <FileIdMesg>{
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    serialNumber: 1234,
    timeCreated: startTime,
  });

  // Interleave records and timer events in time order, events first on ties.
  type Item = { t: number; kind: 0 | 1; i: number };
  const items: Item[] = [
    ...timerEvents.map((e, i): Item => ({ t: e.t, kind: 0, i })),
    ...records.map((r, i): Item => ({ t: r.t, kind: 1, i })),
  ].sort((a, b) => a.t - b.t || a.kind - b.kind || a.i - b.i);

  for (const it of items) {
    if (it.kind === 0) {
      const e = timerEvents[it.i];
      enc.onMesg(Profile.MesgNum.EVENT, <EventMesg>{
        timestamp: at(e.t),
        event: 'timer',
        eventType: e.eventType,
        // timerTrigger is a sub-field of `data`; the Encoder ignores sub-fields, so write data (0 = manual).
        data: 0,
        eventGroup: 0,
      });
    } else {
      const r = records[it.i];
      const mesg: RecordMesg = { timestamp: at(r.t) };
      if (r.lat !== undefined) mesg.positionLat = degreesToSemicircles(r.lat);
      if (r.lon !== undefined) mesg.positionLong = degreesToSemicircles(r.lon);
      if (r.enhancedAltitude !== undefined) mesg.enhancedAltitude = r.enhancedAltitude;
      if (r.altitude !== undefined) mesg.altitude = r.altitude;
      if (r.distance !== undefined) mesg.distance = r.distance;
      if (r.heartRate !== undefined) mesg.heartRate = Math.round(r.heartRate);
      enc.onMesg(Profile.MesgNum.RECORD, mesg);
    }
  }

  if (input.sport !== undefined && records.length > 0) {
    const first = records[0];
    const last = records[records.length - 1];
    const elapsed = last.t - first.t;
    const paused = pausedSeconds(timerEvents);
    enc.onMesg(Profile.MesgNum.SESSION, <SessionMesg>{
      messageIndex: 0,
      timestamp: at(last.t),
      startTime: at(first.t),
      event: 'session',
      eventType: 'stop',
      sport: input.sport,
      subSport: input.subSport ?? 'generic',
      totalElapsedTime: elapsed,
      totalTimerTime: Math.max(0, elapsed - paused),
      totalDistance: last.distance ?? 0,
      firstLapIndex: 0,
      numLaps: 1,
    });
    enc.onMesg(Profile.MesgNum.ACTIVITY, <ActivityMesg>{
      timestamp: at(last.t),
      totalTimerTime: Math.max(0, elapsed - paused),
      numSessions: 1,
      type: 'manual',
      event: 'activity',
      eventType: 'stop',
    });
  }

  return enc.close();
}

function pausedSeconds(events: EncodeTimerEvent[]): number {
  let total = 0;
  let stoppedAt: number | null = null;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.eventType !== 'start') stoppedAt ??= e.t;
    else if (stoppedAt !== null) {
      total += e.t - stoppedAt;
      stoppedAt = null;
    }
  }
  return total;
}
