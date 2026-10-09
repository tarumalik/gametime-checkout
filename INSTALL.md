# Install

Everything below was installed and verified on macOS with Homebrew. GUI alternatives are noted where they exist.

## 1. Core tools

```
brew install node watchman
```

Node runs the Expo tooling and the mock payment server. Watchman is the file watcher React Native's docs recommend.

## 2. iOS simulator

Xcode from the App Store supplies the simulator; the Xcode editor is never opened and no paid account is needed. Point the command line tools at the full Xcode once:

```
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

## 3. Android emulator (no Android Studio needed)

```
brew install --cask temurin@21 android-commandlinetools
```

Add to `~/.zshrc`:

```
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Then install the SDK pieces and create a device:

```
sdkmanager "platform-tools" "platforms;android-35" "emulator" "system-images;android-35;google_apis;arm64-v8a"
avdmanager create avd -n Pixel_8_API_35 -d pixel_8 -k "system-images;android-35;google_apis;arm64-v8a"
```

GUI alternative: install Android Studio and create the same virtual device through Device Manager.

Emulator quality-of-life: with a hardware keyboard attached (the default), Android only shows the on-screen keyboard for secure fields. For the full on-screen keyboard, toggle Settings > System > Languages & input > Physical keyboard > Use on-screen keyboard.

## 4. Project

```
npm install
cd server && npm install
```

Then follow `RUN.md`.
