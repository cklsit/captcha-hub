import { defineConfig } from 'vitest/config';

/**
 * Vitest is intentionally kept separate from vite.config.ts so that the
 * electron plugin (which spawns Electron / needs a build pipeline) is not
 * loaded while running pure unit tests.
 */
export default defineConfig({
  test: {
    // Default to Node; renderer tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock so the pure logic stays fast.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
  },
});
