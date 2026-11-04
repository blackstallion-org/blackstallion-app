// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*'],
  },
  {
    // Module boundaries (06 §3): domain code stays free of React/Expo, and
    // dev-only fixtures are never imported by production UI or core modules.
    files: ['src/features/**/domain/**/*.ts', 'src/ui/tokens/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-native', 'expo*', '@/app/*', '@/ui/components/*'] },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/core/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/dev/*', '**/dev/*'], message: 'Dev fixtures are composed only in src/app and src/dev.' }] },
      ],
    },
  },
  {
    // Test probes capture hook results into module scope on purpose.
    files: ['**/__tests__/**/*.{ts,tsx}'],
    rules: { 'react-hooks/globals': 'off' },
  },
]);
