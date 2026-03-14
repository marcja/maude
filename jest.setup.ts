import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// Explicit cleanup after each test ensures React trees are unmounted and
// effects torn down, even if a test file forgets to call cleanup(). This
// reduces the surface area of the React 19 MessageChannel leak (see
// forceExit comment in jest.config.js) and prevents state bleed between tests.
afterEach(() => {
  cleanup();
});
