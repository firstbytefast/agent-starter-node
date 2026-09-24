import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The TeleQuick mirror under .mirror/ is this tree run through a sed pass.
    // Its tests are the same tests, so running them here would double every
    // count and hide which brand actually failed. `mirror-telequick.sh` says
    // how to run them in the mirror itself.
    exclude: ['**/node_modules/**', '**/dist/**', '.mirror/**'],
  },
});
