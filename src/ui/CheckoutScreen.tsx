import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isBusy } from '../checkout/checkoutMachine';
import type { PaymentDeps } from '../checkout/paymentService';
import { useCheckout } from '../checkout/useCheckout';
import { usePaymentCapabilities } from '../checkout/usePaymentCapabilities';
import { getEligibility } from '../domain/eligibility';
import { FEE_PER_TICKET_CENTS, orderBreakdown, TICKET_PRICE_CENTS } from '../domain/order';
import { DevMenu } from '../env/DevMenu';
import { useDevSettings } from '../env/DevSettings';
import { CardForm } from './CardForm';
import { ExpressCheckout } from './ExpressCheckout';
import { OrderSummary } from './OrderSummary';
import { ConfirmationView, ProcessingOverlay, StatusBanner } from './StatusViews';
import { color, space, type } from './theme';

// Composes the screen: the order summary with its quantity stepper, the
// express methods eligibility derives for the current total, and the card
// form as the universal fallback.

const newOrderId = () => `ord_${Date.now()}`;

export function CheckoutScreen({ deps }: { deps: PaymentDeps }) {
  // Hooks first, always in the same order; no early return above them.
  const { settings } = useDevSettings();
  const [orderId, setOrderId] = useState(newOrderId);
  const [quantity, setQuantity] = useState(2); // 2 tickets = $105: Affirm visible on first open
  const [devMenuOpen, setDevMenuOpen] = useState(false);

  const breakdown = orderBreakdown({
    quantity,
    ticketPriceCents: TICKET_PRICE_CENTS,
    feePerTicketCents: FEE_PER_TICKET_CENTS,
  });
  const totalCents = settings.totalOverrideCents ?? breakdown.totalCents;

  const capabilities = usePaymentCapabilities(settings);
  // Derived, never stored: when the total changes, Affirm appears or
  // disappears on the same render. No effect, no stale copy.
  const eligibility = getEligibility({ ...capabilities, totalCents });
  const checkout = useCheckout({ deps, orderId, totalCents, onRecoveredOrderId: setOrderId });
  const busy = isBusy(checkout.state);

  if (checkout.state.status === 'succeeded') {
    return (
      <ConfirmationView
        payment={checkout.state.payment}
        onDone={() => {
          setOrderId(newOrderId()); // a fresh order: the paid one stays paid
          checkout.reset();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* keyboardShouldPersistTaps: without it, the first tap on Pay while
            the keyboard is open only dismisses the keyboard, and the fan has
            to tap twice. */}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.header}>
            <Text style={type.title} accessibilityRole="header">Checkout</Text>
            {__DEV__ && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open environment simulator"
                onPress={() => setDevMenuOpen(true)}
              >
                <Text style={styles.dev}>Settings</Text>
              </Pressable>
            )}
          </View>
          <OrderSummary
            quantity={quantity}
            onQuantityChange={setQuantity}
            subtotalCents={breakdown.subtotalCents}
            feesCents={breakdown.feesCents}
            totalCents={totalCents}
            totalOverridden={settings.totalOverrideCents !== null}
            disabled={busy}
          />
          <StatusBanner state={checkout.state} onCheckAgain={checkout.checkAgain} />
          <ExpressCheckout
            eligibility={eligibility}
            disabled={busy}
            onWallet={checkout.payWithWallet}
            onAffirm={checkout.payWithAffirm}
          />
          <CardForm totalCents={totalCents} disabled={busy} onSubmit={checkout.payWithCard} />
        </ScrollView>
      </KeyboardAvoidingView>
      <ProcessingOverlay state={checkout.state} />
      {__DEV__ && <DevMenu visible={devMenuOpen} onClose={() => setDevMenuOpen(false)} store={deps.store} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { padding: space.l, gap: space.l },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dev: { color: color.primary },
});
