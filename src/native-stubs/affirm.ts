import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

// Affirm redirect stub, mirroring Affirm's real Direct API flow: create a
// checkout, send the fan to Affirm's page, get a checkout_token back at the
// confirmation URL, authorize server side with that token. The redirect
// backgrounds the app, so the flow has to resume cleanly on return.
//
// The state nonce (the OAuth "state" parameter pattern): Android can re-deliver
// an OLD deep-link intent when the app returns from the browser, so a return
// URL is only trusted if it carries THIS attempt's nonce. Observed in testing:
// a 13-minute-old return URL, with an already-spent token, arrived ahead of
// the real one.

export type AffirmResult =
  | { status: 'confirmed'; checkoutToken: string }
  | { status: 'cancelled' }
  | { status: 'stale' }; // a return from a PREVIOUS attempt: ignore, never submit

/**
 * In Expo Go this is an exp://... URL; in a real build it uses the app.json
 * scheme. The nonce rides along as a query param; the mock server preserves
 * existing params when it appends checkout_token or cancelled.
 */
export function affirmReturnUrl(state: string): string {
  return Linking.createURL('affirm-return', { queryParams: { state } });
}

// Plain string parsing instead of Linking.parse: the return URL is ours, its
// interesting parts are two query params, and this works identically in the
// app and under Jest (Linking.parse needs native constants tests don't have).
function queryParam(url: string, name: string): string | null {
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  for (const pair of query.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (decodeURIComponent(key) === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function parseAffirmReturn(url: string, expectedState: string): AffirmResult {
  if (queryParam(url, 'state') !== expectedState) return { status: 'stale' };
  const token = queryParam(url, 'checkout_token');
  return token !== null && token.length > 0
    ? { status: 'confirmed', checkoutToken: token }
    : { status: 'cancelled' };
}

/**
 * openAuthSessionAsync wraps ASWebAuthenticationSession on iOS and Custom Tabs
 * on Android: the browser opens, and the promise resolves when the page
 * navigates to our return URL, or when the fan closes the browser.
 *
 * On Android the FIRST URL it resolves with can be a replayed old intent, with
 * the genuine return arriving as a Linking event a beat later. So all URL
 * events are buffered during the session, and a stale primary result gets a
 * short grace window for the real one before giving up.
 */
export async function openAffirmCheckout(redirectUrl: string, expectedState: string): Promise<AffirmResult> {
  const lateUrls: string[] = [];
  const sub = Linking.addEventListener('url', (event) => lateUrls.push(event.url));
  try {
    // The MATCH url (what the session watches for) is the bare path, no query:
    // Android's matcher is strict about this prefix, and a nonce in it makes
    // every return look foreign. The nonce still rides on the redirect URL and
    // parseAffirmReturn stays the strict gatekeeper.
    const result = await WebBrowser.openAuthSessionAsync(redirectUrl, Linking.createURL('affirm-return'), {
      preferEphemeralSession: true, // iOS: no cookie sharing with Safari
    });
    if (__DEV__) console.log('[affirm] session result:', result.type, 'url' in result ? result.url : '-', 'buffered:', lateUrls);
    if (result.type !== 'success') return { status: 'cancelled' }; // closed or swiped away

    let parsed = parseAffirmReturn(result.url, expectedState);
    const deadline = Date.now() + 2500;
    while (parsed.status === 'stale' && Date.now() < deadline) {
      const genuine = lateUrls.find((url) => parseAffirmReturn(url, expectedState).status !== 'stale');
      if (genuine) {
        parsed = parseAffirmReturn(genuine, expectedState);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return parsed;
  } finally {
    sub.remove();
  }
}
