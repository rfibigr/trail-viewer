/**
 * The single place where the UI talks to src/fit and src/analysis.
 * A Source is "something we can analyse with options": real FIT file, demo file, or dev mock.
 */
import type { Activity, AnalysisOptions, AnalysisResult } from '../types';
import { analyzeActivity } from '../analysis';

export interface Source {
  name: string;
  startTime: Date | null;
  sport: string | null;
  analyze: (options: AnalysisOptions) => AnalysisResult;
}

/** The FIT SDK is large, so the parser is loaded on first use instead of in the main bundle. */
async function parseFit(buffer: ArrayBuffer, fileName: string): Promise<Activity> {
  const { parseFitFile } = await import('../fit');
  return parseFitFile(buffer, fileName);
}

/** User files: .fit or Garmin Connect's export .zip (the parser sniffs the bytes). */
async function parseUserFile(buffer: ArrayBuffer, fileName: string): Promise<Activity> {
  const { parseActivityFile } = await import('../fit');
  return parseActivityFile(buffer, fileName);
}

/** Accepts .fit, .zip, or no extension (some phone pickers drop it); rejects other known formats early. */
export function checkFileName(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || ext === 'fit' || ext === 'zip') return null;
  if (ext === 'gpx' || ext === 'tcx') {
    return `“${name}” is a ${ext.toUpperCase()} file. Trail Viewer needs the original FIT: in Garmin Connect use ⚙️ → Export File (.zip or .fit).`;
  }
  return `“${name}” isn’t a .fit or .zip file. In Garmin Connect use ⚙️ → Export File.`;
}

function fromActivity(activity: Activity): Source {
  return {
    name: activity.name,
    startTime: activity.startTime,
    sport: activity.sport,
    analyze: (options) => analyzeActivity(activity, options),
  };
}

export async function loadFitFile(file: File): Promise<Source> {
  const problem = checkFileName(file.name);
  if (problem) throw new Error(problem);
  const buffer = await file.arrayBuffer();
  return fromActivity(await parseUserFile(buffer, file.name));
}

// Lazy + tolerant of the module not existing yet, so the demo is code-split out of the main bundle.
const sampleModules = import.meta.glob<{ buildSampleFit: () => Uint8Array }>('../fit/sampleFit.ts');

export async function loadDemo(): Promise<Source> {
  const load = sampleModules['../fit/sampleFit.ts'];
  if (!load) throw new Error('The demo activity isn’t available in this build.');
  const { buildSampleFit } = await load();
  const bytes = buildSampleFit();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return fromActivity(await parseFit(buffer, 'Demo trail run.fit'));
}

/** DEV ONLY: deterministic mock that bypasses fit/ and analysis/. */
export async function loadMock(): Promise<Source> {
  const { mockAnalysisResult, MOCK_ACTIVITY_NAME } = await import('./dev/mockResult');
  return {
    name: MOCK_ACTIVITY_NAME,
    startTime: new Date('2026-07-12T06:30:00'),
    sport: 'trail_running',
    analyze: mockAnalysisResult,
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}
