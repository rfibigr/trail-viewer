import { useSyncExternalStore } from 'react';
import type { Theme } from './colors';

const query = '(prefers-color-scheme: dark)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia(query);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Current colour scheme from prefers-color-scheme, live-updating. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(query).matches ? 'dark' : 'light'),
    () => 'light',
  );
}
