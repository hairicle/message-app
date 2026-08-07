import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.service.ts'],
    },
  },
  esbuild: {
    // The services are Nest providers, so the decorator metadata has to survive compilation even
    // though the tests construct them directly rather than through the DI container.
    target: 'es2021',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
});
