import { parseAffirmReturn } from './affirm';

const STATE = 'nonce-123';

test('a return URL with the right state and a checkout_token is a confirmation', () => {
  expect(
    parseAffirmReturn('gametime-takehome://affirm-return?state=nonce-123&checkout_token=affirm_tok_abc', STATE),
  ).toEqual({ status: 'confirmed', checkoutToken: 'affirm_tok_abc' });
});

test('a return URL with the right state but no token (cancel link) is a cancellation', () => {
  expect(parseAffirmReturn('gametime-takehome://affirm-return?state=nonce-123&cancelled=1', STATE)).toEqual({
    status: 'cancelled',
  });
});

test('a return URL with a WRONG or missing state is stale, even with a token', () => {
  // The replayed-old-intent case seen on Android: an earlier attempt's URL
  // arrives first. It must never be submitted.
  expect(
    parseAffirmReturn('gametime-takehome://affirm-return?state=old-999&checkout_token=affirm_tok_old', STATE),
  ).toEqual({ status: 'stale' });
  expect(parseAffirmReturn('gametime-takehome://affirm-return?checkout_token=affirm_tok_old', STATE)).toEqual({
    status: 'stale',
  });
});
