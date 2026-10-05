"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    setMounted(true);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("theme", next);
    setTheme(next);
  }

  return (
    <button
      aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
    >
      <span aria-hidden="true">{mounted && theme === "dark" ? "☀" : "◐"}</span>
    </button>
  );
}
