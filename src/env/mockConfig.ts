// Lets a reviewer trigger the server's failure paths on demand. The dev menu
// writes the chosen outcome here; the API client's extraHeaders() reads it on
// every request. Module-level state on purpose: the client is plain
// TypeScript with no React in it, so a hook or context cannot reach it.

export type MockOutcome = 'none' | 'decline' | 'timeout' | 'server_error';

let current: { outcome: MockOutcome; delayMs: number } = { outcome: 'none', delayMs: 1500 };

export function setMockConfig(next: typeof current) {
  current = next;
}

export function mockHeaders(): Record<string, string> {
  // __DEV__ is compiled in by the bundler: true in development, false in a
  // release build, where this returns nothing and the mock layer disappears.
  if (!__DEV__) return {};
  const headers: Record<string, string> = { 'X-Mock-Delay-Ms': String(current.delayMs) };
  if (current.outcome !== 'none') headers['X-Mock-Outcome'] = current.outcome;
  return headers;
}
