/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
      },
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__generated__/**',
  ],
  moduleNameMapper: {
    '^@recommendation-items/(.*)$': '<rootDir>/src/$1',
    '^@test-utils/(.*)$': '<rootDir>/../../shared/test-utils/$1'
  },
  setupFilesAfterEnv: [],
  testTimeout: 30000,
};