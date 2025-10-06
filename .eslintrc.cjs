module.exports = {
    root: true,
    env: {
        node: true,
        es2021: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2021,
    },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    ignorePatterns: ['dist', 'node_modules', '**/*.js', '**/*.d.ts'],
    rules: {
        'no-restricted-syntax': [
            'error',
            {
                selector: "NewExpression[callee.name='Pool']",
                message: 'Use the shared pool exported from the db module.',
            },
        ],
    },
    overrides: [
        {
            files: ['src/db/pool.ts', 'apps/services/payments/src/db.ts', 'scripts/migrate.ts'],
            rules: {
                'no-restricted-syntax': 'off',
            },
        },
    ],
};
