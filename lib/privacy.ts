export function calendarView<T extends { title?: string; location?: string; participant?: string; category?: string; notes?: string; start: string; end?: string }>(event: T, mode: "private" | "full" | "title_time" | "busy", isOwner: boolean) {
  if (isOwner || mode === "full") return event;
  if (mode === "private") return null;
  if (mode === "busy") return { start: event.start, end: event.end, title: "忙碌" };
  return { start: event.start, end: event.end, title: event.title || "日程" };
}

export function notificationBody(kind: "assignment" | "family" | "document" | "health" | "general", actorName?: string) {
  if (kind === "assignment") return `${actorName || "對方"} 指派了一項工作給你`;
  if (kind === "family") return "你有一項家庭事項需要處理";
  if (kind === "document") return "一項私人文件即將到期";
  if (kind === "health") return "你今日有一項健康行政事項";
  return "你有一項事項需要留意";
}

export function shareIncludes(input: { sensitive: boolean; includeAttachments: boolean; includeLinkedDocuments: boolean; includeComments: boolean; includeSubtasks: boolean }) {
  return { includeAttachments: input.sensitive ? false : input.includeAttachments, includeLinkedDocuments: input.sensitive ? false : input.includeLinkedDocuments, includeComments: input.includeComments, includeSubtasks: input.includeSubtasks };
}
