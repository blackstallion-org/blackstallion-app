import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local store for NON-sensitive preferences only (06 §4).
 * Tokens and private data never go here; they belong to the secure store (G3).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const asyncStorageStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

export const createMemoryStore = (seed: Record<string, string> = {}): KeyValueStore => {
  const data = new Map(Object.entries(seed));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
};
