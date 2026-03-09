const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/**
 * ESM packages that Jest must transform rather than leave as raw ESM.
 *
 * react-markdown ecosystem: needed for StreamingMarkdown component (T13)
 * until-async: transitive ESM dependency of msw 2.x (required by T06+)
 *
 * Why the async export is needed: next/jest prepends its own
 * transformIgnorePatterns including `/node_modules/.pnpm/(?!(geist)@)` which
 * blocks any pnpm-internal package not named 'geist' from being transformed.
 * Packages like `until-async` are only accessible via their `.pnpm/` deep path
 * (no root symlink hop), so next/jest's pattern blocks them. The async export
 * lets us replace the full array after next/jest builds its base config.
 */
const ESM_PACKAGES = [
  'react-markdown',
  'remark-gfm',
  'remark-parse',
  'unified',
  'bail',
  'trough',
  'vfile',
  'unist-util-stringify-position',
  'unist-util-visit',
  'hast-util-to-jsx-runtime',
  'hast-util-whitespace',
  'property-information',
  'space-separated-tokens',
  'comma-separated-tokens',
  'decode-named-character-reference',
  'character-entities',
  'mdast-util-from-markdown',
  'mdast-util-to-markdown',
  'mdast-util-gfm',
  'micromark',
  'ccount',
  'escape-string-regexp',
  'trim-lines',
  'until-async',
].join('|');

/** @type {import('jest').Config} */
const baseConfig = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // React 19's scheduler creates an internal MessageChannel (MESSAGEPORT) that
  // Jest cannot clean up, causing "worker failed to exit gracefully" warnings.
  // forceExit is the recommended workaround until the scheduler is patched.
  forceExit: true,
  // Exclude Playwright E2E tests — they run via `pnpm playwright test`, not Jest.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/tests/e2e/'],
  // setupFilesAfterEnv runs after the test framework is installed in the environment,
  // so expect.extend() calls in @testing-library/jest-dom can find the global expect.
  // (setupFiles runs before the framework; @testing-library/jest-dom needs expect to exist.)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironmentOptions: {
    // Replace jsdom's default 'browser' export condition with Node.js conditions.
    // Required for msw/node whose "browser" subpath export is explicitly null —
    // it cannot load under browser conditions. With 'node' added, the resolver
    // finds the CJS build at ./lib/node/index.js via the 'node > require' chain.
    // Per MSW 1.x→2.x migration guide and mswjs/msw#1786.
    customExportConditions: ['node', 'require', 'default'],
  },
};

module.exports = async () => {
  const config = await createJestConfig(baseConfig)();

  // Replace next/jest's default transformIgnorePatterns so that ESM_PACKAGES
  // are transformed in both path forms pnpm uses:
  //   Symlinked:    node_modules/<pkg>/...
  //   Direct pnpm:  node_modules/.pnpm/<pkg>@x.y.z/node_modules/<pkg>/...
  config.transformIgnorePatterns = [
    // Symlinked packages (node_modules/<pkg>/...):
    //   (?!.pnpm) skips the .pnpm deep-path prefix so Pattern 2 handles those.
    //   The second negative lookahead excludes known ESM packages from ignoring.
    `node_modules/(?!\\.pnpm)(?!(${ESM_PACKAGES})/)`,
    // Direct pnpm packages (node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/...):
    //   Exclude known ESM packages by name — the lookahead checks for <name>@
    //   (the @ separates the package name from the version string in pnpm paths).
    `node_modules/.pnpm/(?!(${ESM_PACKAGES})@)`,
    '^.+\\.module\\.(css|sass|scss)$',
  ];

  return config;
};
