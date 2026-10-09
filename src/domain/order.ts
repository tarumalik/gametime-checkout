// Prices chosen so the quantity stepper crosses the Affirm line:
// 1 ticket = $45.00 + $7.50 fee = $52.50 (no Affirm), 2 tickets = $105.00 (Affirm appears).
export const TICKET_PRICE_CENTS = 4_500;
export const FEE_PER_TICKET_CENTS = 750;

export type OrderLine = {
  quantity: number;
  ticketPriceCents: number;
  feePerTicketCents: number;
};

export function orderBreakdown({ quantity, ticketPriceCents, feePerTicketCents }: OrderLine) {
  const subtotalCents = quantity * ticketPriceCents;
  const feesCents = quantity * feePerTicketCents;
  return { subtotalCents, feesCents, totalCents: subtotalCents + feesCents };
}
