import {
  detectBrand,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  passesLuhn,
  validateCard,
  validateCardNumber,
  validateCvc,
  validateExpiry,
} from './card';

// Month index 8 = September (JS months are 0-based). Local time, like the device.
const NOW = new Date(2026, 8, 28);

describe('detectBrand', () => {
  test.each([
    ['4242424242424242', 'visa'],
    ['5555555555554444', 'mastercard'],
    ['2223003122003222', 'mastercard'], // 2-series
    ['378282246310005', 'amex'],
    ['6011111111111117', 'discover'],
    ['9999', 'unknown'],
  ])('%s is %s', (number, brand) => expect(detectBrand(number)).toBe(brand));
});

describe('passesLuhn', () => {
  test('accepts known test numbers', () => {
    ['4242424242424242', '5555555555554444', '378282246310005', '6011111111111117', '4000000000000002'].forEach(
      (n) => expect(passesLuhn(n)).toBe(true),
    );
  });
  test('rejects a single-digit typo', () => expect(passesLuhn('4242424242424241')).toBe(false));
});

describe('formatCardNumber', () => {
  test('groups Visa in 4s', () => expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242'));
  test('groups Amex 4-6-5', () => expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005'));
  test('strips junk from paste or autofill', () =>
    expect(formatCardNumber('4242-4242 4242.4242')).toBe('4242 4242 4242 4242'));
  test('truncates to brand length', () => expect(formatCardNumber('37828224631000599')).toBe('3782 822463 10005'));
});

describe('validateCardNumber', () => {
  test('incomplete while typing', () => expect(validateCardNumber('4242 42').status).toBe('incomplete'));
  test('invalid when complete but fails Luhn', () =>
    expect(validateCardNumber('4242 4242 4242 4241').status).toBe('invalid'));
  test('valid test card', () => expect(validateCardNumber('4242 4242 4242 4242').status).toBe('valid'));
  test('unsupported brand is a firm no after 4 digits', () =>
    expect(validateCardNumber('9999').status).toBe('invalid'));
});

describe('expiry', () => {
  test.each([
    ['4', '04'], // no month starts with 4
    ['1', '1'], // could still become 10, 11, 12
    ['12', '12'],
    ['123', '12/3'],
    ['1228', '12/28'],
    ['12/2028', '12/28'], // autofill MM/YYYY normalized
    ['12/28', '12/28'],
  ])('formatExpiry(%s) = %s', (input, out) => expect(formatExpiry(input)).toBe(out));

  test.each([
    ['09/26', 'valid'], // current month: valid through its last day
    ['08/26', 'invalid'], // last month: expired
    ['01/27', 'valid'],
    ['13', 'invalid'], // impossible month, flagged immediately
    ['00', 'invalid'],
    ['12/4', 'incomplete'],
    ['12/46', 'valid'],
    ['12/47', 'invalid'], // more than 20 years out
  ])('validateExpiry(%s) is %s', (input, status) => expect(validateExpiry(input, NOW).status).toBe(status));
});

describe('cvc', () => {
  test('3 digits for Visa', () => {
    expect(validateCvc('123', '4242').status).toBe('valid');
    expect(formatCvc('1234', '4242')).toBe('123');
  });
  test('4 digits for Amex', () => {
    expect(validateCvc('123', '3782').status).toBe('incomplete');
    expect(validateCvc('1234', '3782').status).toBe('valid');
  });
});

test('validateCard requires all three fields', () => {
  expect(validateCard({ number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123' }, NOW).isValid).toBe(true);
  expect(validateCard({ number: '4242 4242 4242 4242', expiry: '08/26', cvc: '123' }, NOW).isValid).toBe(false);
  expect(validateCard({ number: '4242 4242 4242 4242', expiry: '12/28', cvc: '12' }, NOW).isValid).toBe(false);
});
