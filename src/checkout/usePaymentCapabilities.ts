import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { Capability, DevicePlatform } from '../domain/eligibility';
import type { DevSettings, Tri } from '../env/DevSettings';
import { canMakeApplePayPayments, isGooglePayReady } from '../native-stubs/walletCapabilities';

// Runs the device wallet checks (a provisioned card for Apple Pay, Google
// Pay readiness), applies any dev-menu override, and keeps the answer fresh.

async function resolveCapability(override: Tri, detect: () => Promise<boolean>): Promise<Capability> {
  if (override !== 'auto') return override === 'yes' ? 'available' : 'unavailable';
  try {
    return (await detect()) ? 'available' : 'unavailable';
  } catch {
    // A check that fails must never produce a button that might not work:
    // fail closed, exactly like the vendors' own sample code.
    return 'unavailable';
  }
}

export function usePaymentCapabilities(settings: DevSettings) {
  const platform: DevicePlatform =
    settings.platform !== 'auto' ? settings.platform : Platform.OS === 'ios' ? 'ios' : 'android';
  const [applePay, setApplePay] = useState<Capability>('checking');
  const [googlePay, setGooglePay] = useState<Capability>('checking');
  const [refreshCount, setRefreshCount] = useState(0);

  // Re-check when the app returns to the foreground: the fan might have left,
  // added a card to Wallet, and come back. Apple Pay should then appear.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setRefreshCount((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // If settings change mid-check, results from the outdated check must not
    // land: the cleanup flips `stale` and the late results are dropped.
    let stale = false;
    (async () => {
      const ap = platform === 'ios' ? await resolveCapability(settings.applePay, canMakeApplePayPayments) : 'unavailable';
      const gp = platform === 'android' ? await resolveCapability(settings.googlePay, isGooglePayReady) : 'unavailable';
      if (!stale) {
        setApplePay(ap);
        setGooglePay(gp);
      }
    })();
    return () => {
      stale = true;
    };
    // Note: no reset to 'checking' on a re-check. That would make an already
    // visible button flicker to a placeholder and back.
  }, [platform, settings.applePay, settings.googlePay, refreshCount]);

  return { platform, applePay, googlePay };
}
