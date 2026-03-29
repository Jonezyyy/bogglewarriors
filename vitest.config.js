import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        testTimeout: 10000,
        env: {
            VITEST: '1',
            SCORES_DB_PATH: ':memory:',
        },
    },
});
