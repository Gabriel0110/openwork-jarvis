export const APP_THEME_STORAGE_KEY = "openwork-jarvis.theme"

export const APP_THEMES = ["default", "human", "orc", "undead", "night-elf"] as const

export type AppTheme = (typeof APP_THEMES)[number]

function normalizeTheme(value: string | null | undefined): AppTheme {
  if (!value) {
    return "default"
  }
  return APP_THEMES.includes(value as AppTheme) ? (value as AppTheme) : "default"
}

export function getStoredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "default"
  }
  return normalizeTheme(window.localStorage.getItem(APP_THEME_STORAGE_KEY))
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === "undefined") {
    return
  }
  document.documentElement.setAttribute("data-theme", normalizeTheme(theme))
}

export function setStoredTheme(theme: AppTheme): void {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
}
