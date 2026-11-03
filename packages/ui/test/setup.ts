import "@testing-library/jest-dom/vitest";

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
