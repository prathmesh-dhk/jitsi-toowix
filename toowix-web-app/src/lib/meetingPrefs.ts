import { useCallback, useState } from 'react';

const PREFIX = 'toowix_pref_';

const DEFAULTS = {
  pushToTalk: false,
  autoPip: 'always' as 'always' | 'never',
  desktopNotifications: false,
  leaveEmptyCalls: false,
  joinLeaveSounds: true,
  sendResolution: 0,
  receiveResolution: 0
};

export type MeetingPrefs = typeof DEFAULTS;

export function getPref<K extends keyof MeetingPrefs>(key: K): MeetingPrefs[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);

    return raw === null ? DEFAULTS[key] : JSON.parse(raw);
  } catch {
    return DEFAULTS[key];
  }
}

export function useMeetingPref<K extends keyof MeetingPrefs>(key: K): [ MeetingPrefs[K], (value: MeetingPrefs[K]) => void ] {
  const [ value, setValue ] = useState<MeetingPrefs[K]>(() => getPref(key));
  const update = useCallback((next: MeetingPrefs[K]) => {
    setValue(next);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(next));
    } catch { /* storage unavailable */ }
  }, [ key ]);

  return [ value, update ];
}

export function notifyDesktop(title: string, body: string) {
  try {
    if (getPref('desktopNotifications') && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

export interface ISavedBackground {
  backgroundType: 'blur' | 'image' | 'none';
  blurValue?: number;
  virtualSource?: string;
}

export function getSavedBackground(): ISavedBackground | null {
  try {
    const raw = localStorage.getItem('toowix_virtual_background');
    const parsed = raw ? JSON.parse(raw) : null;

    return parsed && parsed.backgroundType && parsed.backgroundType !== 'none' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBackground(config: ISavedBackground | null) {
  try {
    if (config && config.backgroundType !== 'none') {
      localStorage.setItem('toowix_virtual_background', JSON.stringify(config));
    } else {
      localStorage.removeItem('toowix_virtual_background');
    }
  } catch { /* storage unavailable */ }
}
