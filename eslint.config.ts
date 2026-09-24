import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // The TeleQuick mirror under .mirror/ is generated output, not source: it is
  // this tree run through a sed pass, so linting it only reports the same
  // findings twice.
  { ignores: ['.mirror/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
]);
