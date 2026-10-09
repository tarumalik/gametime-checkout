// SDK capability stubs. Each one mirrors the exact native API it stands in
// for, so swapping in the real SDK later only touches these files.

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for PassKit's PKPaymentAuthorizationController
 * .canMakePayments(usingNetworks:), the call that answers "is a card actually
 * provisioned in Wallet" (plain canMakePayments() only answers "is Apple Pay
 * possible on this hardware"). Async and fallible, like a real bridge call.
 * The stub reports a provisioned Wallet; the "no card in Wallet" case is
 * reviewed through the environment simulator.
 */
export async function canMakeApplePayPayments(): Promise<boolean> {
  await delay(400); // real checks take time; this keeps the "checking" state observable
  return true;
}

/** Stand-in for Google Pay's PaymentsClient.isReadyToPay(IsReadyToPayRequest). */
export async function isGooglePayReady(): Promise<boolean> {
  await delay(400);
  return true;
}
