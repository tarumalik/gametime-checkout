import { orderBreakdown, TICKET_PRICE_CENTS, FEE_PER_TICKET_CENTS } from './order';

test('order total includes per-ticket fees', () => {
  expect(orderBreakdown({ quantity: 2, ticketPriceCents: 4500, feePerTicketCents: 750 })).toEqual({
    subtotalCents: 9000,
    feesCents: 1500,
    totalCents: 10500,
  });
});

test('one ticket stays under the Affirm line, two cross it', () => {
  const line = { ticketPriceCents: TICKET_PRICE_CENTS, feePerTicketCents: FEE_PER_TICKET_CENTS };
  expect(orderBreakdown({ quantity: 1, ...line }).totalCents).toBe(5250);
  expect(orderBreakdown({ quantity: 2, ...line }).totalCents).toBe(10500);
});
