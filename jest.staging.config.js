// Staging integration suites: the app's real repositories against the LOCAL Supabase stack (backend-local/,
// load_staging.sh). Not part of `npm test`; run with `npm run test:staging` once the stack is up.
// Plain Node environment (real fetch/undici, no React Native jest setup), Expo's Babel preset for TS and the @/ alias.
module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/integration/staging'],
  testMatch: ['**/*.staging.ts'],
  testEnvironment: 'node',
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] })] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1', '^expo-sqlite$': '<rootDir>/integration/staging/expoSqliteStub.ts', '^expo-file-system/legacy$': '<rootDir>/integration/staging/expoFileSystemStub.ts', '^expo-file-system$': '<rootDir>/integration/staging/expoFileSystemStub.ts' },
  transformIgnorePatterns: ['/node_modules/(?!expo/virtual/)'],
  maxWorkers: 1,
};
