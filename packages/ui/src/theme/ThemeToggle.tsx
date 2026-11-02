import { useRef, type KeyboardEvent } from "react";
import { useTheme, type Theme } from "./theme";

const options: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "auto", label: "Sistema" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % options.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index + options.length - 1) % options.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTheme(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      className="ui-theme-control"
      role="radiogroup"
      aria-label="Tema de exibição"
    >
      {options.map((option, index) => (
        <button
          aria-checked={theme === option.value}
          className="ui-button"
          key={option.value}
          onClick={() => setTheme(option.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          role="radio"
          ref={(element) => {
            refs.current[index] = element;
          }}
          tabIndex={theme === option.value ? 0 : -1}
          type="button"
          data-variant={theme === option.value ? "primary" : "secondary"}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
