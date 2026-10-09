import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Eligibility, ExpressMethod, WalletMethod } from '../domain/eligibility';
import { color, radius, space } from './theme';

// Renders exactly what eligibility says: real buttons for available methods,
// a placeholder (same height as a button, so nothing jumps when the check
// resolves) for pending wallets, and nothing at all for ineligible ones.
// Wallets render first: Apple's guidelines want Apple Pay as the primary
// option once a provisioned card is found.

const LABELS: Record<ExpressMethod, string> = {
  apple_pay: ' Pay',
  google_pay: 'G Pay',
  affirm: 'Pay over time with Affirm',
};

type Props = {
  eligibility: Eligibility;
  disabled: boolean;
  onWallet: (method: WalletMethod) => void;
  onAffirm: () => void;
};

export function ExpressCheckout({ eligibility, disabled, onWallet, onAffirm }: Props) {
  const express = eligibility.methods.filter((m): m is ExpressMethod => m !== 'card');
  if (express.length === 0 && eligibility.pending.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">EXPRESS CHECKOUT</Text>
      {eligibility.pending.map((method) => (
        <View key={method} style={[styles.button, styles.placeholder]} accessible accessibilityLabel="Checking payment options">
          <ActivityIndicator color={color.subtle} />
        </View>
      ))}
      {express.map((method) => (
        <Pressable
          key={method}
          accessibilityRole="button"
          accessibilityLabel={
            method === 'apple_pay' ? 'Apple Pay' : method === 'google_pay' ? 'Google Pay' : LABELS.affirm
          }
          disabled={disabled}
          onPress={() => (method === 'affirm' ? onAffirm() : onWallet(method))}
          style={({ pressed }) => [
            styles.button,
            styles[method],
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.text, method === 'affirm' && styles.affirmText]}>{LABELS[method]}</Text>
        </Pressable>
      ))}
      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <Text style={styles.or}>or pay with card</Text>
        <View style={styles.orLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.m },
  heading: { fontSize: 12, letterSpacing: 0.8, color: color.subtle, fontWeight: '600' },
  button: { height: 50, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center' },
  placeholder: { backgroundColor: color.surface },
  apple_pay: { backgroundColor: color.applePay },
  google_pay: { backgroundColor: color.googlePay },
  affirm: { backgroundColor: color.bg, borderWidth: 1.5, borderColor: color.affirm },
  text: { color: '#fff', fontWeight: '600', fontSize: 17 },
  affirmText: { color: color.affirm },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.xs },
  orLine: { flex: 1, height: 1, backgroundColor: color.border },
  or: { color: color.subtle, fontSize: 13 },
});
