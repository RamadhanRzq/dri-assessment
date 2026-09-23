import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Vitest does not put .env.test into process.env on its own, and Nest's
// ConfigModule then falls back to .env — which points at the development
// database. Passing the values through `test.env` makes process.env win
// (dotenv never overrides an existing variable), so the suite cannot wipe
// development data.
const testEnv = Object.fromEntries(
  readFileSync('.env.test', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      NODE_ENV: testEnv.NODE_ENV ?? 'test',
      DATABASE_URL: testEnv.DATABASE_URL,
    },
  },
});
