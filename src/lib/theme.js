const KEY = "chiparama-theme";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function currentTheme() {
  return document.documentElement.dataset.theme || "light";
}
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage may be blocked */ }
}
export function initTheme() {
  const saved = read();
  const t = saved === "dark" ? "dark" : "light"; // cream light is the default
  document.documentElement.dataset.theme = t;
}
