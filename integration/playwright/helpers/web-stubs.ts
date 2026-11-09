/**
 * Native module stubs for Expo web builds. These replace native-only packages that crash in
 * Chromium. Load via metro.config.js resolver or webpack alias when running Playwright.
 *
 * expo-secure-store -> in-memory Map (token storage works in web tests)
 * expo-camera -> no-op component (scan screen renders but camera is inert)
 * expo-location -> fixed coordinates (hub A: Vijayawada)
 * expo-haptics -> no-op
 */

// expo-secure-store stub
const store = new Map<string, string>();
export const SecureStore = {
  getItemAsync: async (key: string) => store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { store.set(key, value); },
  deleteItemAsync: async (key: string) => { store.delete(key); },
};

// expo-location stub
export const Location = {
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 16.50625, longitude: 80.64805, altitude: null, accuracy: 10, heading: null, speed: null },
    timestamp: Date.now(),
  }),
};

// expo-haptics stub
export const Haptics = {
  impactAsync: async () => {},
  notificationAsync: async () => {},
  selectionAsync: async () => {},
};

// expo-camera stub (React component placeholder)
export const CameraView = () => null;
export const useCameraPermissions = () => [{ granted: false, canAskAgain: true }, async () => ({ granted: false })];
