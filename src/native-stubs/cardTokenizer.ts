import { detectBrand, digitsOnly, type CardInput } from '../domain/card';

/**
 * Stand-in for a tokenizing SDK (Stripe, Braintree). In production the card
 * number goes from the SDK straight to the processor, and our servers only
 * ever see an opaque token; that is what keeps a merchant out of PCI scope.
 * The stub encodes brand + last4 so the mock server can simulate test-card
 * outcomes: ...0002 declines, ...9995 is insufficient funds.
 */
export async function tokenizeCard(card: CardInput): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const digits = digitsOnly(card.number);
  return `tok_card_${detectBrand(digits)}_${digits.slice(-4)}`;
}
