import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatCents } from '../domain/money';
import { color, radius, space, type } from './theme';

// The quantity stepper exists so a reviewer can watch Affirm's eligibility
// react as the total crosses the $100 line. It locks while a payment is busy
// so the amount can't shift mid-charge.

type Props = {
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  subtotalCents: number;
  feesCents: number;
  totalCents: number;
  totalOverridden: boolean; // dev-menu override active: say so, never silently lie
  disabled: boolean;
};

export function OrderSummary({
  quantity,
  onQuantityChange,
  subtotalCents,
  feesCents,
  totalCents,
  totalOverridden,
  disabled,
}: Props) {
  const step = (delta: number) => onQuantityChange(quantity + delta);
  return (
    <View style={styles.card}>
      <Text style={type.heading}>Warriors vs. Lakers</Text>
      <Text style={type.label}>Sec 112 · Row F · Chase Center</Text>
      <View style={styles.row}>
        <Text style={type.body}>Tickets</Text>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove a ticket"
            accessibilityState={{ disabled: disabled || quantity <= 1 }}
            // 36pt visual circle + 4pt slop each side = the 44pt minimum target
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            disabled={disabled || quantity <= 1}
            onPress={() => step(-1)}
            style={({ pressed }) => [styles.step, (disabled || quantity <= 1) && styles.stepDisabled, pressed && styles.pressed]}
          >
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text accessibilityLabel={`${quantity} tickets`} style={type.heading}>
            {quantity}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a ticket"
            accessibilityState={{ disabled: disabled || quantity >= 8 }}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            disabled={disabled || quantity >= 8}
            onPress={() => step(1)}
            style={({ pressed }) => [styles.step, (disabled || quantity >= 8) && styles.stepDisabled, pressed && styles.pressed]}
          >
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={type.body}>Subtotal</Text>
        <Text style={type.body}>{formatCents(subtotalCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={type.body}>Fees</Text>
        <Text style={type.body}>{formatCents(feesCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={type.money}>Total{totalOverridden ? ' (dev override)' : ''}</Text>
        <Text style={type.money}>{formatCents(totalCents)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.l,
    borderRadius: radius.l,
    backgroundColor: color.surface,
    gap: space.s,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, backgroundColor: color.border, marginVertical: space.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDisabled: { opacity: 0.35 },
  stepText: { fontSize: 20, color: color.ink },
  pressed: { opacity: 0.7 },
});
