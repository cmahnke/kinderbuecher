import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['dist/'],
  },
  // vendored ambient types for the untyped tify package (see src/tify.d.ts)
  {
    files: ['src/tify.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
