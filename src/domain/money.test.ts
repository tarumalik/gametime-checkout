import { formatCents } from './money';

test.each([
  [0, '$0.00'],
  [5, '$0.05'],
  [10500, '$105.00'],
  [123456, '$1,234.56'],
  [-250, '-$2.50'],
])('formatCents(%i) = %s', (cents, expected) => {
  expect(formatCents(cents)).toBe(expected);
});
