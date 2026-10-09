// AsyncStorage is a native module. Jest runs in plain Node with no native side,
// so we swap in the official in-memory mock published by the library itself.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
