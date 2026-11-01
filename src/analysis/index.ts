import type { Activity, AnalysisOptions, AnalysisResult } from '../types';

/** Turn a parsed Activity into plot-ready data. Owner: analysis agent. Must be pure and synchronous. */
export function analyzeActivity(_activity: Activity, _options: AnalysisOptions): AnalysisResult {
  throw new Error('not implemented');
}
