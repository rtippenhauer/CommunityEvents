import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The e2e/integration suite: real AppModule, real guards, real HTTP stack,
 * real MySQL (the throwaway container from docker/docker-compose.test.yml).
 * See vitest.config.ts for the unit suite and for why the SWC plugin is
 * required rather than optional.
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
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    root: '.',
    // Applies the schema once, before the first spec file.
    globalSetup: ['test/global-setup.ts'],
    // Dummy secrets and the test DB connection, in the worker, before the app
    // module is constructed.
    setupFiles: ['test/setup-env.ts'],
    // One file at a time. Every spec truncates the whole database in its
    // beforeEach, so two files running concurrently would delete each other's
    // fixtures. This is Jest's maxWorkers: 1.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
