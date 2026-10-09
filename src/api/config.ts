import { Platform } from 'react-native';

// The two simulators reach the Mac differently: the iOS Simulator shares the
// Mac's network, so localhost works; the Android emulator is its own VM, and
// 10.0.2.2 is its alias for the host.
// A physical phone would need the Mac's LAN IP here instead.
// This reads the REAL Platform.OS on purpose: the dev menu's platform override
// changes eligibility only, never networking.
export const API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
