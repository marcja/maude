const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // setupFilesAfterEnv runs after the test framework is installed in the environment,
  // so expect.extend() calls in @testing-library/jest-dom can find the global expect.
  // (setupFiles runs before the framework; @testing-library/jest-dom needs expect to exist.)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Allow ESM packages (react-markdown, remark-gfm, unified ecosystem) to be
  // transformed by SWC rather than excluded from the transform pipeline.
  transformIgnorePatterns: [
    'node_modules/(?!(react-markdown|remark-gfm|remark-parse|unified|bail|trough|vfile|unist-util-stringify-position|unist-util-visit|hast-util-to-jsx-runtime|hast-util-whitespace|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|mdast-util-from-markdown|mdast-util-to-markdown|mdast-util-gfm|micromark|ccount|escape-string-regexp|trim-lines)/)',
  ],
};

module.exports = createJestConfig(config);
