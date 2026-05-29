/**
 * Vitest configuration — added 2026-05-26 by the QA pass.
 *
 * The repo previously had ZERO unit-test infrastructure (only the
 * tRPC-integration scripts under scripts/*). This config bootstraps
 * Vitest with happy-dom so we can cover pure utilities (src/lib/*)
 * and small client components without spinning the full Next runtime.
 *
 * To enable, install dev deps and add a script in package.json:
 *
 *   pnpm add -D vitest @vitest/ui happy-dom \
 *     @testing-library/react @testing-library/jest-dom @testing-library/user-event
 *
 *   // package.json scripts
 *   "test":          "vitest run",
 *   "test:watch":    "vitest",
 *   "test:coverage": "vitest run --coverage"
 *
 * The first set of tests lives in src/lib/__tests__/. Add more as the
 * codebase grows; keep them next to the file they cover via the
 * `__tests__` convention.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'workers', 'scripts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**'],
      exclude: ['**/*.d.ts', '**/__tests__/**', '**/index.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
