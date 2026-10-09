// The $100 Affirm boundary has to be exact, which is why money is its own
// module. All money in this app is integer cents. In JavaScript 0.1 + 0.2 gives
// 0.30000000000000004, so a float total could land at $100.0000001 and wrongly
// unlock Affirm. Integers make every comparison exact: 10500 means $105.00.

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  // Insert thousands separators ourselves so output never depends on the
  // device's Intl locale support: 123456 -> "1,234.56".
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
