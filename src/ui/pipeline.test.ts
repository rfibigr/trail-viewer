import { describe, expect, it } from 'vitest';
import { checkFileName } from './pipeline';

describe('checkFileName', () => {
  it('accepts .fit, .zip (any case) and extension-less names', () => {
    expect(checkFileName('run.fit')).toBeNull();
    expect(checkFileName('123_ACTIVITY.FIT')).toBeNull();
    expect(checkFileName('export.ZIP')).toBeNull();
    expect(checkFileName('activity')).toBeNull();
  });
  it('explains GPX/TCX and other files', () => {
    expect(checkFileName('run.gpx')).toMatch(/GPX file/);
    expect(checkFileName('run.tcx')).toMatch(/TCX file/);
    expect(checkFileName('photo.jpg')).toMatch(/isn’t a \.fit or \.zip/);
  });
});
