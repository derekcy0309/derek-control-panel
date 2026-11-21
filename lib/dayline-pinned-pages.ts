// This allowlist serves the picker, link renderer and server input validation.
// Store only internal destinations; shortcuts do not grant access to a page.
export const PINNED_PAGE_GROUPS = [
  { label: "每日使用", options: [
    { href: "/", label: "今日總覽" },
    { href: "/#task-action-list", label: "我的任務" },
    { href: "/calendar", label: "日曆" },
    { href: "/work-guide", label: "開工導航" },
    { href: "/capture", label: "快速收集" },
    { href: "/workspace/inbox", label: "收集箱" },
    { href: "/briefing", label: "資訊站" },
    { href: "/traffic", label: "交通" }
  ] },
  { label: "計劃及協作", options: [
    { href: "/workspace/waiting", label: "等回覆" },
    { href: "/todo-list", label: "列印待辦" },
    { href: "/request-duty", label: "值班安排" },
    { href: "/sharing", label: "交辦分享" },
    { href: "/weekly-review", label: "每週檢視" },
    { href: "/body-double", label: "同步專注" },
    { href: "/workspace/decision", label: "決策紀錄" }
  ] },
  { label: "家庭", options: [
    { href: "/workspace/family", label: "家庭總覽" },
    { href: "/workspace/school", label: "子女學校" },
    { href: "/workspace/pet", label: "寵物" },
    { href: "/workspace/household", label: "家居" },
    { href: "/workspace/shopping", label: "購物" }
  ] },
  { label: "個人", options: [
    { href: "/workspace/personal", label: "個人總覽" },
    { href: "/workspace/health", label: "健康行政" },
    { href: "/medications", label: "藥物紀錄" },
    { href: "/workspace/vehicle", label: "車輛" },
    { href: "/workspace/note", label: "私人筆記" },
    { href: "/cashflow", label: "個人財務" }
  ] },
  { label: "設定及搜尋", options: [
    { href: "/search", label: "全域搜尋" },
    { href: "/settings", label: "設定" }
  ] }
] as const;

type PinnedPage = (typeof PINNED_PAGE_GROUPS)[number]["options"][number];
export type PinnedPageHref = PinnedPage["href"];
export type PinnedSlot = PinnedPageHref | "";
export const MAX_PINNED_PAGES = 5;
export const TASKS_PIN = "/#task-action-list";
export const DEFAULT_PINNED_PAGES: readonly PinnedPageHref[] = ["/", TASKS_PIN, "/calendar", "/briefing", "/traffic"];

const optionsByHref = new Map<string, PinnedPage>();
for (const group of PINNED_PAGE_GROUPS) {
  for (const option of group.options) optionsByHref.set(option.href, option);
}

export function pinnedPageLabel(href: PinnedPageHref) {
  return optionsByHref.get(href)?.label ?? "";
}

export function isPinnedPageHref(value: unknown): value is PinnedPageHref {
  return typeof value === "string" && optionsByHref.has(value);
}

export function validatePinnedPages(value: unknown): value is PinnedPageHref[] {
  // Empty arrays are already the database default and mean the original bar.
  return Array.isArray(value) && value.length <= MAX_PINNED_PAGES
    && [...value].every(isPinnedPageHref) && new Set(value).size === value.length;
}

export function readPinnedPages(value: unknown): PinnedPageHref[] {
  if (!Array.isArray(value)) return [...DEFAULT_PINNED_PAGES];
  const available = [...new Set(value.filter(isPinnedPageHref))].slice(0, MAX_PINNED_PAGES);
  return available.length ? available : [...DEFAULT_PINNED_PAGES];
}

export function makePinnedSlots(pins: readonly PinnedPageHref[]): PinnedSlot[] {
  return Array.from({ length: MAX_PINNED_PAGES }, (_, i) => pins[i] ?? "");
}

export function updatePinnedSlot(slots: readonly PinnedSlot[], index: number, value: PinnedSlot): PinnedSlot[] {
  const next = [...slots];
  if (!Number.isInteger(index) || index < 0 || index >= next.length || next[index] === value) return next;
  const existing = value ? next.indexOf(value) : -1;
  if (existing >= 0) next[existing] = next[index];
  next[index] = value;
  return next;
}

export function pinnedPageIsCurrent(href: PinnedPageHref, pathname: string, tab: string) {
  if (href === "/") return pathname === "/" && tab !== "tasks";
  if (href === TASKS_PIN) return (pathname === "/" && tab === "tasks") || pathname === "/tasks" || pathname.startsWith("/tasks/");
  return pathname === href || pathname.startsWith(href + "/");
}
