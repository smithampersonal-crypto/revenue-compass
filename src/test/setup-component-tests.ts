/**
 * Component-test setup. This file is loaded for every test file, but only does
 * work when a DOM is present, so the pure accounting suite in the node
 * environment is unaffected.
 */
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  const { afterEach } = await import("vitest");
  afterEach(() => {
    cleanup();
  });
}

export {};
