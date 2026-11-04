// G5 test entry point (Field Ops care, offline sync, i18n). The root jest config also runs src/**/__tests__;
// this config adds the slower *.g5int.ts integration suites (process kill, local Postgres replica; skipped unless
// G5_PG_PORT is set). SQLite/file tests pick the node environment with a @jest-environment docblock.
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src/features/care', '<rootDir>/src/features/sync'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/integration/**/*.g5int.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
