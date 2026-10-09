import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CheckoutState } from '../checkout/checkoutMachine';
import type { PaymentRecord } from '../api/paymentsApi';
import { formatCents } from '../domain/money';
import { color, radius, space, type } from './theme';

// The state-to-screen mapping. The banner carries notices and errors, the
// overlay covers the busy states, and the confirmation replaces the screen
// on success.

export function StatusBanner({ state, onCheckAgain }: { state: CheckoutState; onCheckAgain: () => void }) {
  let tone: 'info' | 'error' | 'warning' | null = null;
  let text = '';
  if (state.status === 'idle' && state.notice) {
    tone = 'info';
    text = state.notice;
  }
  if (state.status === 'declined') {
    tone = 'error';
    text = `${state.message} Try another card or payment method.`;
  }
  if (state.status === 'failed') {
    tone = 'error';
    text = state.message;
  }
  if (state.status === 'reconciling' && state.stalled) {
    tone = 'warning';
    text = "We're still confirming your payment. Please don't pay again. We'll update this as soon as we know.";
  }
  if (!tone) return null;
  return (
    <View style={[styles.banner, styles[tone]]} accessibilityLiveRegion="polite">
      <Text style={type.body}>{text}</Text>
      {state.status === 'reconciling' && (
        <Pressable accessibilityRole="button" onPress={onCheckAgain} style={styles.bannerAction}>
          <Text style={styles.link}>Check again</Text>
        </Pressable>
      )}
    </View>
  );
}

const WAITING: Record<string, string> = {
  card: 'Securing your card…',
  apple_pay: 'Waiting for Apple Pay…',
  google_pay: 'Waiting for Google Pay…',
  affirm: 'Waiting for Affirm…',
};

export function ProcessingOverlay({ state }: { state: CheckoutState }) {
  let text: string | null = null;
  if (state.status === 'authorizing') text = WAITING[state.method];
  if (state.status === 'processing') text = 'Processing your payment…';
  if (state.status === 'reconciling' && !state.stalled) text = 'Checking on your payment…';
  if (!text) return null;
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.overlay]}
      accessibilityLiveRegion="polite"
      // iOS: keep screen-reader focus on the overlay, not the controls under it.
      accessibilityViewIsModal
    >
      <ActivityIndicator size="large" color={color.primary} />
      <Text style={styles.overlayText}>{text}</Text>
    </View>
  );
}

const METHOD_NAMES: Record<string, string> = {
  card: 'card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  affirm: 'Affirm',
};

export function ConfirmationView({ payment, onDone }: { payment: PaymentRecord; onDone: () => void }) {
  const methodName = METHOD_NAMES[payment.method] ?? payment.method;
  return (
    <SafeAreaView style={styles.confirm}>
      <View style={styles.badge}>
        <Text style={styles.badgeCheck}>✓</Text>
      </View>
      <Text style={type.title}>You're going!</Text>
      <Text style={type.body}>
        {formatCents(payment.amountCents)} paid with {methodName}
      </Text>
      <Text style={styles.receipt}>Payment {payment.paymentId}</Text>
      <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
        <Text style={styles.doneText}>Buy more tickets</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: { padding: space.m, borderRadius: radius.s, gap: space.xs },
  info: { backgroundColor: color.infoBg },
  error: { backgroundColor: color.dangerBg },
  warning: { backgroundColor: color.warnBg },
  bannerAction: { alignSelf: 'flex-start' },
  link: { color: color.primary, fontWeight: '600' },
  overlay: {
    backgroundColor: 'rgba(255,255,255,0.93)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.m,
  },
  overlayText: { fontSize: 17, color: color.ink },
  confirm: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, padding: space.xl, backgroundColor: color.bg },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCheck: { fontSize: 30, color: color.successInk },
  receipt: { color: color.subtle, fontSize: 12 },
  done: { marginTop: space.l, paddingVertical: 14, paddingHorizontal: space.xl, borderRadius: radius.m, backgroundColor: color.primary },
  doneText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  pressed: { opacity: 0.8 },
});
