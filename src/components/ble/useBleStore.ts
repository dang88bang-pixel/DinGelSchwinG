/**
 * Gemeinsame React-Anbindung an den BleSuiteStore.
 * Einfacher Observer: re-render nach jeder notify().
 */
import { useEffect, useState } from 'react';
import { BleSuiteStore, bleSuiteStore } from '../../lib/ble/suiteStore';

export function useBleStore(store: BleSuiteStore = bleSuiteStore): BleSuiteStore {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
  return store;
}
