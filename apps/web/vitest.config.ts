import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The app's tsconfig sets jsx: "preserve" for Next's own compiler, which leaves esbuild with
  // untransformed JSX in .tsx test files. Compile it here instead.
  esbuild: { jsx: 'automatic' },
  test: {
    // Node is enough: these suites cover pure logic, not rendered components. Anything needing a
    // DOM opts in per-file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/hooks/**', 'src/components/Linkify.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@messenger/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
});
