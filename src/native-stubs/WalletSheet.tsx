import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WalletMethod } from '../domain/eligibility';
import { formatCents } from '../domain/money';

// Wallet sheet stub. The real SDKs expose "present the sheet, then await the
// result", so this provider owns the modal and hands callers exactly that:
// const result = await presentWalletSheet({...}).

export type WalletSheetRequest = { method: WalletMethod; amountCents: number; merchantName: string };
export type WalletSheetResult = { status: 'authorized'; token: string } | { status: 'cancelled' };
type Present = (request: WalletSheetRequest) => Promise<WalletSheetResult>;

const WalletSheetContext = createContext<Present | null>(null);
const NAMES: Record<WalletMethod, string> = { apple_pay: 'Apple Pay', google_pay: 'Google Pay' };

export function useWalletSheet(): Present {
  const present = useContext(WalletSheetContext);
  if (!present) throw new Error('useWalletSheet must be used inside <WalletSheetProvider>');
  return present;
}

export function WalletSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<WalletSheetRequest | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  // The bridge between the two worlds: present() hands out a promise and parks
  // its resolve function here; whichever button the fan taps later calls it.
  const resolveRef = useRef<((result: WalletSheetResult) => void) | null>(null);

  const present = useCallback<Present>(
    (next) =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setAuthenticating(false);
        setRequest(next); // request !== null is what makes the modal visible
      }),
    [],
  );

  const finish = (result: WalletSheetResult) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setRequest(null);
    setAuthenticating(false);
  };

  const confirm = async () => {
    if (!request) return;
    setAuthenticating(true);
    // Simulated Face ID / fingerprint pause. On a real device the OS prompt
    // sends the app to 'inactive'; backgrounding the simulator during this
    // spinner exercises the same survival path.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    finish({ status: 'authorized', token: `tok_${request.method}_${Date.now()}` });
  };

  return (
    <WalletSheetContext.Provider value={present}>
      {children}
      <Modal
        visible={request !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          // Android back button. Ignored mid-authentication, like the real sheet.
          if (!authenticating) finish({ status: 'cancelled' });
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.stub}>SIMULATED: stands in for the native payment sheet</Text>
            <Text style={styles.title}>{request ? NAMES[request.method] : ''}</Text>
            <Text>Pay {request?.merchantName}</Text>
            <Text style={styles.amount}>{request ? formatCents(request.amountCents) : ''}</Text>
            {authenticating ? (
              <View style={styles.row}>
                <ActivityIndicator />
                <Text>{request?.method === 'apple_pay' ? ' Face ID…' : ' Verifying…'}</Text>
              </View>
            ) : (
              <>
                <Pressable accessibilityRole="button" style={styles.pay} onPress={confirm}>
                  <Text style={styles.payText}>
                    {request?.method === 'apple_pay' ? 'Confirm with Face ID' : 'Continue'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={styles.cancel}
                  onPress={() => finish({ status: 'cancelled' })}
                >
                  <Text>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </WalletSheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff',
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  stub: { fontSize: 11, color: '#888' },
  title: { fontSize: 22, fontWeight: '600' },
  amount: { fontSize: 28, fontWeight: '700', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, justifyContent: 'center' },
  pay: { backgroundColor: '#000', padding: 16, borderRadius: 10, alignItems: 'center' },
  payText: { color: '#fff', fontWeight: '600' },
  cancel: { padding: 12, alignItems: 'center' },
});
