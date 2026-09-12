import { defineConfig } from 'vitest/config';

// Phase 4: `npm test` – Frontend-Unit-Tests (happy-dom für window/localStorage).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    reporters: 'basic',
  },
});
