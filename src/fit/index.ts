import type { Activity } from '../types';

/** Parse a FIT file into an Activity. Owner: fit agent. */
export async function parseFitFile(_data: ArrayBuffer, _fileName: string): Promise<Activity> {
  throw new Error('not implemented');
}
