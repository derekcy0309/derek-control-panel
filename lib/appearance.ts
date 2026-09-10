export const visualThemes = ["sunrise", "ocean", "aurora", "night_shift"] as const;
export type VisualTheme = (typeof visualThemes)[number];

export const visualIntensities = ["quiet", "balanced", "vivid"] as const;
export type VisualIntensity = (typeof visualIntensities)[number];

export type SectionIdentity = "today" | "family" | "personal" | "work" | "finance" | "health" | "system";

export function normalizeVisualTheme(value: string | null | undefined, prefersDark = false): VisualTheme {
  if (value === "dark" || value === "night_shift") return "night_shift";
  if (value === "ocean" || value === "aurora" || value === "sunrise") return value;
  if (value === "system") return prefersDark ? "night_shift" : "sunrise";
  return "sunrise";
}

export function normalizeVisualIntensity(value: string | null | undefined): VisualIntensity {
  return visualIntensities.includes(value as VisualIntensity) ? value as VisualIntensity : "balanced";
}

export function cssColourMode(theme: VisualTheme) {
  return theme === "night_shift" ? "dark" : "light";
}

export function sectionIdentityForPath(pathname: string): SectionIdentity {
  if (pathname === "/") return "today";
  if (pathname === "/cashflow") return "finance";
  if (pathname === "/medications" || pathname.startsWith("/workspace/health")) return "health";
  if (/^\/workspace\/(family|school|pet|household|shopping)/.test(pathname) || pathname === "/request-duty") return "family";
  if (/^\/workspace\/(personal|vehicle|note)/.test(pathname)) return "personal";
  if (pathname.startsWith("/settings") || pathname.startsWith("/search") || pathname.startsWith("/admin")) return "system";
  return "work";
}

export function applyAppearance(themeValue: string | null | undefined, intensityValue: string | null | undefined) {
  if (typeof document === "undefined") return;
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = normalizeVisualTheme(themeValue, prefersDark);
  document.documentElement.dataset.theme = cssColourMode(theme);
  document.documentElement.dataset.palette = theme;
  document.documentElement.dataset.intensity = normalizeVisualIntensity(intensityValue);
}
