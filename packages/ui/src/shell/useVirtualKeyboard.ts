import { useEffect } from "react";

export function useVirtualKeyboard() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const keyboardInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      const editing =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches(
          "input, textarea, select, [contenteditable='true']",
        );
      const open = editing && keyboardInset > 120;
      document.documentElement.dataset.keyboard = open ? "open" : "closed";
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${open ? keyboardInset : 0}px`,
      );
      if (open)
        document.activeElement?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
    };
    const onFocus = () => window.setTimeout(update, 80);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      delete document.documentElement.dataset.keyboard;
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
