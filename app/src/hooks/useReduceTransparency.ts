// One process-wide Reduce Transparency subscription. Each frosted bubble
// used to register its own listener, so opening a thread bridged to
// native once per visible row.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached = false;
let loaded = false;
const listeners = new Set<(value: boolean) => void>();
let subscribed = false;

const publish = (value: boolean) => {
  loaded = true;
  cached = value;
  for (const listener of listeners) listener(value);
};

const ensureSubscribed = () => {
  if (subscribed) return;
  subscribed = true;
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then(publish)
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', publish);
};

export const useReduceTransparency = (): boolean => {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    ensureSubscribed();
    listeners.add(setValue);
    if (loaded) setValue(cached);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
};
