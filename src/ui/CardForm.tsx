import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  cvcLengthFor,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  validateCard,
  validateCardNumber,
  validateExpiry,
  type CardInput,
  type FieldCheck,
} from '../domain/card';
import { formatCents } from '../domain/money';
import { color, radius, space, type } from './theme';

// Validation rules live in domain/card.ts; this component decides WHEN the
// fan sees them: errors show when a field is complete-but-wrong (immediately)
// or incomplete-after-blur, and clear on the keystroke that fixes the field.
// Never red mid-typing. The Pay button stays disabled until the whole card
// is valid.

type Field = keyof CardInput;
type Props = { totalCents: number; disabled: boolean; onSubmit: (card: CardInput) => void; now?: () => Date };

const BRAND_LABEL = { visa: 'VISA', mastercard: 'Mastercard', amex: 'AMEX', discover: 'Discover', unknown: '' };

export function CardForm({ totalCents, disabled, onSubmit, now = () => new Date() }: Props) {
  const [card, setCard] = useState<CardInput>({ number: '', expiry: '', cvc: '' });
  const [touched, setTouched] = useState<Record<Field, boolean>>({ number: false, expiry: false, cvc: false });
  const expiryRef = useRef<TextInput>(null);
  const cvcRef = useRef<TextInput>(null);

  // Derived on every render, never stored, so validity can't drift out of
  // sync with what's actually in the inputs.
  const result = validateCard(card, now());
  const canSubmit = result.isValid && !disabled;

  const errorFor = (field: Field, check: FieldCheck) =>
    check.status === 'invalid' || (touched[field] && check.status === 'incomplete') ? check.message : undefined;
  const touch = (field: Field) => setTouched((t) => ({ ...t, [field]: true }));

  const onNumber = (text: string) => {
    const number = formatCardNumber(text);
    // A brand change can shorten the CVC: typing an Amex after a 3-digit CVC
    // keeps it, but switching from Amex to Visa trims a 4th digit.
    setCard((c) => ({ ...c, number, cvc: formatCvc(c.cvc, number) }));
    // number-pad has no Return key on iOS, so advance focus automatically.
    if (validateCardNumber(number).status === 'valid') expiryRef.current?.focus();
  };
  const onExpiry = (text: string) => {
    const expiry = formatExpiry(text);
    setCard((c) => ({ ...c, expiry }));
    if (validateExpiry(expiry, now()).status === 'valid') cvcRef.current?.focus();
  };
  const onCvc = (text: string) => setCard((c) => ({ ...c, cvc: formatCvc(text, c.number) }));

  const submit = () => {
    if (!canSubmit) return; // the button is disabled, but guard the call path too
    onSubmit(card);
  };

  const numberError = errorFor('number', result.number);
  const expiryError = errorFor('expiry', result.expiry);
  const cvcError = errorFor('cvc', result.cvc);

  return (
    <View style={styles.form}>
      <Text style={styles.label}>
        Card number {BRAND_LABEL[result.brand] ? `· ${BRAND_LABEL[result.brand]}` : ''}
      </Text>
      <TextInput
        accessibilityLabel="Card number"
        style={[styles.input, numberError && styles.inputError]}
        value={card.number}
        onChangeText={onNumber}
        onBlur={() => touch('number')}
        placeholder="1234 5678 9012 3456"
        keyboardType="number-pad"
        textContentType="creditCardNumber"
        autoComplete="cc-number"
        autoCorrect={false}
        editable={!disabled}
      />
      {numberError && <Text style={styles.error}>{numberError}</Text>}

      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>Expiry</Text>
          <TextInput
            ref={expiryRef}
            accessibilityLabel="Expiry date"
            style={[styles.input, expiryError && styles.inputError]}
            value={card.expiry}
            onChangeText={onExpiry}
            onBlur={() => touch('expiry')}
            placeholder="MM/YY"
            keyboardType="number-pad"
            textContentType="creditCardExpiration"
            autoComplete="cc-exp"
            // Deliberately no maxLength: keychain autofill hands over "12/2028"
            // as one value, and a native 5-char cap would clip it to "12/20"
            // (December 2020, expired) before formatExpiry can normalize it.
            // Typed input is already capped: the field is controlled and
            // formatExpiry never returns more than MM/YY.
            editable={!disabled}
          />
          {expiryError && <Text style={styles.error}>{expiryError}</Text>}
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>Security code</Text>
          <TextInput
            ref={cvcRef}
            accessibilityLabel="Security code"
            style={[styles.input, cvcError && styles.inputError]}
            value={card.cvc}
            onChangeText={onCvc}
            onBlur={() => touch('cvc')}
            placeholder={cvcLengthFor(card.number) === 4 ? '1234' : '123'}
            keyboardType="number-pad"
            textContentType="creditCardSecurityCode"
            autoComplete="cc-csc"
            secureTextEntry
            maxLength={cvcLengthFor(card.number)}
            editable={!disabled}
          />
          {cvcError && <Text style={styles.error}>{cvcError}</Text>}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={submit}
        style={({ pressed }) => [styles.pay, !canSubmit && styles.payDisabled, pressed && styles.pressed]}
      >
        <Text style={styles.payText}>{`Pay ${formatCents(totalCents)}`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 6 },
  label: { ...type.label, marginTop: space.s },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.m,
    padding: space.m,
    fontSize: 17,
    color: color.ink,
    backgroundColor: color.bg,
  },
  inputError: { borderColor: color.danger },
  error: { color: color.danger, fontSize: 13 },
  row: { flexDirection: 'row', gap: space.m },
  half: { flex: 1 },
  pay: {
    marginTop: space.l,
    backgroundColor: color.primary,
    padding: space.l,
    borderRadius: radius.m,
    alignItems: 'center',
  },
  payDisabled: { backgroundColor: color.primaryDisabled },
  pressed: { opacity: 0.8 },
  payText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
