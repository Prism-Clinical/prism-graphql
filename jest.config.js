module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/apps', '<rootDir>/shared'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/tests/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'apps/**/src/**/*.ts',
    '!apps/**/src/**/*.d.ts',
    '!apps/**/src/__generated__/**',
    '!apps/**/dist/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1, // Prevent parallel tests from interfering with shared test database
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@test-utils/(.*)$': '<rootDir>/shared/test-utils/$1',
    '^@test-utils$': '<rootDir>/shared/test-utils',
    // Shared packages
    '^@prism/security$': '<rootDir>/shared/security/src',
    '^@prism/security/(.*)$': '<rootDir>/shared/security/src/$1',
    '^@prism/service-clients$': '<rootDir>/shared/service-clients/src',
    '^@prism/service-clients/(.*)$': '<rootDir>/shared/service-clients/src/$1',
    // App services
    '^@patients/(.*)$': '<rootDir>/apps/patients-service/src/$1',
    '^@providers/(.*)$': '<rootDir>/apps/providers-service/src/$1',
    '^@recommendations/(.*)$': '<rootDir>/apps/recommendations-service/src/$1',
    '^@recommendation-items/(.*)$': '<rootDir>/apps/recommendation-items-service/src/$1',
    '^@institutions/(.*)$': '<rootDir>/apps/institutions-service/src/$1',
    '^@epic-api/(.*)$': '<rootDir>/apps/epic-api-service/src/$1',
    '^@epic-mock/(.*)$': '<rootDir>/apps/epic-mock-service/src/$1',
    '^@gateway/(.*)$': '<rootDir>/gateway/$1',
    // CISS Services
    '^@transcription/(.*)$': '<rootDir>/apps/transcription-service/src/$1',
    '^@rag/(.*)$': '<rootDir>/apps/rag-service/src/$1',
    '^@safety/(.*)$': '<rootDir>/apps/safety-service/src/$1',
    '^@careplan/(.*)$': '<rootDir>/apps/careplan-service/src/$1'
  }
};