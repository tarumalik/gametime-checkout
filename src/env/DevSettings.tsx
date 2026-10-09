import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DevicePlatform } from '../domain/eligibility';
import { setMockConfig, type MockOutcome } from './mockConfig';

// Settings for the environment simulator. Auto means real detection; every
// override is opt-in, persisted across reloads, and __DEV__ only.

export type Tri = 'auto' | 'yes' | 'no';
export type DevSettings = {
  platform: 'auto' | DevicePlatform;
  applePay: Tri;
  googlePay: Tri;
  totalOverrideCents: number | null; // null = use the real order total
  mockOutcome: MockOutcome;
  mockDelayMs: number;
};

export const defaultDevSettings: DevSettings = {
  platform: 'auto',
  applePay: 'auto',
  googlePay: 'auto',
  totalOverrideCents: null,
  mockOutcome: 'none',
  mockDelayMs: 1500,
};

const KEY = 'gametime.devSettings.v1';
type Ctx = { settings: DevSettings; update: (patch: Partial<DevSettings>) => void };
const DevSettingsContext = createContext<Ctx | null>(null);

export function DevSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultDevSettings);
  const [loaded, setLoaded] = useState(!__DEV__);

  useEffect(() => {
    if (!__DEV__) return;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        // Merge over defaults so a settings shape change never crashes old data.
        if (raw) setSettings({ ...defaultDevSettings, ...JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded && __DEV__) AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
    // Keep the module-level mock config in sync so the API client sees it.
    setMockConfig({ outcome: settings.mockOutcome, delayMs: settings.mockDelayMs });
  }, [settings, loaded]);

  const update = useCallback((patch: Partial<DevSettings>) => setSettings((prev) => ({ ...prev, ...patch })), []);

  // Hold rendering one beat: otherwise the first frame would show REAL
  // eligibility and then snap to the overridden one.
  if (!loaded) return null;
  return <DevSettingsContext.Provider value={{ settings, update }}>{children}</DevSettingsContext.Provider>;
}

export function useDevSettings(): Ctx {
  const ctx = useContext(DevSettingsContext);
  if (!ctx) throw new Error('useDevSettings must be used inside <DevSettingsProvider>');
  return ctx;
}
