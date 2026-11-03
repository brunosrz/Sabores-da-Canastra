import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

// pnpm can resolve jest-dom's Vitest peer through a different virtual package.
// Augment the Vitest instance used by these tests as well.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends matchers.TestingLibraryMatchers<T, R> {}
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") ? false : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
    writable: true,
  });

  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}
