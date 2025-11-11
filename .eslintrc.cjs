module.exports = {
  root: true,
  ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '.cache'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: { react: { version: 'detect' } },
  overrides: [
    {
      files: ['apps/backend/**/*.ts'],
      env: { node: true, es2021: true },
      parserOptions: { sourceType: 'module' },
      rules: {},
    },
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      env: { browser: true, es2021: true },
      parserOptions: { ecmaFeatures: { jsx: true } },
      rules: {},
    },
  ],
};