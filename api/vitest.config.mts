import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Unit/integration tests that live next to the code (`src/**\/*.spec.ts`).
 * The e2e suite has its own config — see vitest.config.e2e.ts — because it
 * needs a real database, a schema migration before the first spec, and no
 * parallelism.
 *
 * The SWC plugin is not optional. NestJS resolves constructor dependencies
 * from `design:paramtypes`, which only exists if the transform emits decorator
 * metadata; Vite's default esbuild transform does not, and every provider then
 * fails to instantiate with "Nest can't resolve dependencies".
 */
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
      },
      module: { type: 'nodenext' },
    }),
  ],
  test: {
    // describe/it/expect without an import in every file, matching how the
    // inherited Jest suites are written.
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: '.',
    coverage: {
      provider: 'v8',
      reportsDirectory: '../coverage',
      include: ['src/**/*.ts'],
    },
  },
});
