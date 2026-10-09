# Run

Two processes run side by side in two terminals: the mock payment server and the app. Start the server first.

## 1. Payment server

```
cd server
npm install        # first time only
npm start          # listens on port 4000
```

The app reaches it at `localhost:4000` from the iOS simulator and `10.0.2.2:4000` from the Android emulator (both baked into `src/api/config.ts`, no setup needed). Payments and Affirm checkouts can be inspected at `http://localhost:4000/v1/_debug/payments` while testing.

## 2. App

```
npm install        # first time only
```

iOS simulator:

```
npm run ios
```

Android emulator (boot the emulator first, then):

```
npm run android
```

The Android script does two extra things on purpose. It maps port 8081 through adb and pins the dev server address to `127.0.0.1`, so the Affirm browser round trip returns to the app through the adb tunnel instead of the Wi-Fi network. Expo's default uses the machine's Wi-Fi address in deep links, which breaks on networks with client isolation; the pinned form works on any network, including none.

## 3. Tests

```
npm test                 # app unit and component tests
npm run typecheck        # TypeScript, no emit
cd server && npm test    # server contract tests, real HTTP
```

## Simulating environments

In a dev build, the "Settings" button on the checkout screen opens the environment simulator: force the platform, wallet availability, order total, backend outcome (decline, timeout, 500) and latency. "Auto" everywhere means real detection. Details in the README.

## Troubleshooting

- "Cannot connect to Expo CLI" on Android: the adb port mapping died with an emulator restart. Quit Expo (`Ctrl+C`) and run `npm run android` again, which re-creates it.
- An Affirm attempt on Android lands back on the checkout with no result and no charge recorded. Most often this is the second Affirm run in one Expo Go session: Android re-delivers the previous run's return link from the recents stack, and the app refuses any replayed return rather than risk submitting a stale or already-used approval (check `_debug/payments`: the previous charge is there once, the new token is unused). Reset the dev shell and it works again: `adb shell pm clear host.exp.exponent`, then reopen the project. This is an Expo Go artifact; a production build returns on the app's own scheme with no dev server or launcher task in the loop.
- Port already in use: find the stale process with `lsof -nP -iTCP:8081 -sTCP:LISTEN` (or `:4000`) and kill that pid.
- On the Android emulator the soft keyboard only appears at the CVC field. With a hardware keyboard attached (`hw.keyboard=yes`, the Mac's), Android hides the on-screen keyboard except for password fields, and the CVC is one (`secureTextEntry`). The other fields take Mac keystrokes; for uniform on-screen behavior, enable "Use on-screen keyboard" in the emulator's physical keyboard settings.
