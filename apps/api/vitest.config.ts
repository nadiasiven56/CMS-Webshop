import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: [],
    // Snel feedback in dev — verhoog timeouts in CI bij Postgres-testcontainer
    testTimeout: 10_000,
  },
});
