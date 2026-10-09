import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PendingPayment, PendingPaymentStore } from '../checkout/pendingPaymentStore';
import { color, radius, space, type } from '../ui/theme';
import { useDevSettings } from './DevSettings';

// The environment simulator: force platform, wallet state, total, backend
// outcome and latency, so every eligibility and failure case can be walked on
// one simulator. Every row defaults to Auto (real detection); the whole
// screen only exists in dev builds. The pending-record inspector at the
// bottom makes the kill-and-relaunch demo visible: reviewers can watch the
// write-ahead record appear and clear.

type Option<T> = { label: string; value: T };

function OptionRow<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={selected ? styles.chipTextSelected : styles.chipText}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const TRI = [
  { label: 'Auto', value: 'auto' as const },
  { label: 'Yes', value: 'yes' as const },
  { label: 'No', value: 'no' as const },
];

export function DevMenu({
  visible,
  onClose,
  store,
}: {
  visible: boolean;
  onClose: () => void;
  store: PendingPaymentStore;
}) {
  const { settings, update } = useDevSettings();
  const [pending, setPending] = useState<PendingPayment | null>(null);
  useEffect(() => {
    if (visible) store.load().then(setPending);
  }, [visible, store]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={type.title}>Environment simulator</Text>
        <Text style={type.label}>
          Real device: {Platform.OS}. Auto = real detection (the default).
        </Text>

        <OptionRow
          label="Platform"
          value={settings.platform}
          onChange={(platform) => update({ platform })}
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'iOS', value: 'ios' },
            { label: 'Android', value: 'android' },
          ]}
        />
        <OptionRow
          label="Apple Pay: card in Wallet"
          value={settings.applePay}
          onChange={(applePay) => update({ applePay })}
          options={TRI}
        />
        <OptionRow
          label="Google Pay: ready"
          value={settings.googlePay}
          onChange={(googlePay) => update({ googlePay })}
          options={TRI}
        />
        <OptionRow
          label="Order total"
          value={settings.totalOverrideCents}
          onChange={(totalOverrideCents) => update({ totalOverrideCents })}
          options={[
            { label: 'From quantity', value: null },
            { label: '$100.00', value: 10000 },
            { label: '$100.01', value: 10001 },
            { label: '$450', value: 45000 },
          ]}
        />
        <OptionRow
          label="Backend outcome"
          value={settings.mockOutcome}
          onChange={(mockOutcome) => update({ mockOutcome })}
          options={[
            { label: 'Normal', value: 'none' },
            { label: 'Decline', value: 'decline' },
            { label: 'Timeout', value: 'timeout' },
            { label: '500', value: 'server_error' },
          ]}
        />
        <OptionRow
          label="Backend latency"
          value={settings.mockDelayMs}
          onChange={(mockDelayMs) => update({ mockDelayMs })}
          options={[
            { label: '1.5s', value: 1500 },
            { label: '8s (for kill tests)', value: 8000 },
          ]}
        />

        <Text style={styles.rowLabel}>Pending payment record</Text>
        <Text style={styles.mono}>{pending ? JSON.stringify(pending, null, 2) : 'none'}</Text>
        <Pressable
          onPress={() => store.clear().then(() => setPending(null))}
          style={styles.chip}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>Clear pending record</Text>
        </Pressable>

        <Pressable onPress={onClose} style={[styles.chip, styles.close]} accessibilityRole="button">
          <Text style={styles.chipText}>Close</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, paddingTop: 32, gap: space.l, backgroundColor: color.bg },
  row: { gap: space.s },
  rowLabel: { fontWeight: '600', color: color.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: {
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border,
    alignSelf: 'flex-start',
  },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { color: color.ink },
  chipTextSelected: { color: '#fff' },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: color.subtle },
  close: { marginTop: space.l },
});
