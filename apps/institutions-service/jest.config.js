/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__generated__/**',
  ],
  moduleNameMapping: {
    '^@institutions/(.*)$': '<rootDir>/src/$1',
    '^@test-utils/(.*)$': '<rootDir>/../../shared/test-utils/$1'
  },
  setupFilesAfterEnv: [],
  testTimeout: 30000,
  globals: {
    'ts-jest': {
      tsconfig: {
        compilerOptions: {
          module: 'commonjs',
        },
      },
    },
  },
};