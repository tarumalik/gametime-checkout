import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_BASE_URL } from './src/api/config';
import { createPaymentsApi } from './src/api/paymentsApi';
import { createPendingPaymentStore } from './src/checkout/pendingPaymentStore';
import type { PaymentDeps } from './src/checkout/paymentService';
import { DevSettingsProvider } from './src/env/DevSettings';
import { mockHeaders } from './src/env/mockConfig';
import { WalletSheetProvider } from './src/native-stubs/WalletSheet';
import { CheckoutScreen } from './src/ui/CheckoutScreen';

// Composition root: build the real dependencies once, outside React, so the
// same instances live for the app's lifetime and everything below stays
// testable with fakes. Real detection and the real client are the defaults;
// the dev menu only overrides them per request.
const deps: PaymentDeps = {
  api: createPaymentsApi({ baseUrl: API_BASE_URL, extraHeaders: mockHeaders }),
  store: createPendingPaymentStore(),
  newIdempotencyKey: () => Crypto.randomUUID(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export default function App() {
  return (
    <SafeAreaProvider>
      <DevSettingsProvider>
        <WalletSheetProvider>
          <CheckoutScreen deps={deps} />
        </WalletSheetProvider>
      </DevSettingsProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
