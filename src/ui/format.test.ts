import { describe, expect, it } from 'vitest';
import {
  directionLabel,
  formatClock,
  formatDuration,
  formatElevation,
  formatGrade,
  formatInt,
  formatKm,
  formatVerticalSpeed,
} from './format';

describe('formatDuration', () => {
  it('formats h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00:00');
    expect(formatDuration(59.6)).toBe('0:01:00');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(30 * 3600 + 5)).toBe('30:00:05');
  });
  it('rejects bad input', () => {
    expect(formatDuration(-1)).toBe('–');
    expect(formatDuration(NaN)).toBe('–');
  });
});

describe('formatClock', () => {
  it('formats h:mm', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5400)).toBe('1:30');
    expect(formatClock(3599)).toBe('1:00');
  });
});

describe('numbers', () => {
  it('formatInt uses separators and typographic minus', () => {
    expect(formatInt(1234.4)).toBe('1,234');
    expect(formatInt(-1234.6)).toBe('−1,235');
    expect(formatInt(-0.2)).toBe('0');
  });
  it('formatKm', () => {
    expect(formatKm(12345)).toBe('12.35 km');
    expect(formatKm(500, 1)).toBe('0.5 km');
    expect(formatKm(NaN)).toBe('–');
  });
  it('formatElevation', () => {
    expect(formatElevation(2412.7)).toBe('2,413 m');
  });
  it('formatVerticalSpeed is signed', () => {
    expect(formatVerticalSpeed(732.2)).toBe('+732 m/h');
    expect(formatVerticalSpeed(-1105)).toBe('−1,105 m/h');
    expect(formatVerticalSpeed(0.3)).toBe('0 m/h');
  });
  it('formatGrade is signed with one decimal', () => {
    expect(formatGrade(12.34)).toBe('+12.3%');
    expect(formatGrade(-4)).toBe('−4.0%');
    expect(formatGrade(0.01)).toBe('0.0%');
    expect(formatGrade(-0.04)).toBe('0.0%');
  });
});

describe('directionLabel', () => {
  it('labels directions', () => {
    expect(directionLabel('up')).toBe('Climb');
    expect(directionLabel('down')).toBe('Descent');
    expect(directionLabel('flat')).toBe('Flat');
  });
});
