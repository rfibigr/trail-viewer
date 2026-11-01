import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_OPTIONS } from '../../types';
import { mockAnalysisResult } from './mockResult';

describe('mockAnalysisResult', () => {
  it('is deterministic and internally consistent', () => {
    const a = mockAnalysisResult(DEFAULT_ANALYSIS_OPTIONS);
    const b = mockAnalysisResult(DEFAULT_ANALYSIS_OPTIONS);
    expect(a.summary).toEqual(b.summary);
    expect(a.segments.length).toBeGreaterThan(5);
    expect(a.segments[0].startIndex).toBe(0);
    expect(a.segments[a.segments.length - 1].endIndex).toBe(a.points.length - 1);
    for (let i = 1; i < a.segments.length; i++) {
      expect(a.segments[i].startIndex).toBe(a.segments[i - 1].endIndex + 1);
    }
    for (const p of a.points) expect(a.segments[p.segmentIndex]).toBeDefined();
    expect(a.summary.totalGain).toBeGreaterThan(2000);
    expect(a.summary.elapsedTime).toBeGreaterThan(a.summary.movingTime);
  });
});
