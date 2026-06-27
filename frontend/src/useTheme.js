import { useState, useEffect } from "react";

export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("bambu-theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      theme === "light" ? "light" : ""
    );
    localStorage.setItem("bambu-theme", theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  return { theme, toggle };
}
