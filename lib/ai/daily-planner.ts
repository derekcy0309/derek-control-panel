import type { TodayPlanRole, WorkWindow } from "../types.ts";

export type PlannerCandidate = {
  taskId: string;
  title: string;
  nextAction: string | null;
  minutes: number;
  score: number;
  reasons: string[];
  energy: "low" | "medium" | "high" | null;
};

export type PlannerSelection = {
  taskId: string;
  suggestedMinutes: number;
  reason: string;
  firstStep: string;
  effortTip: string | null;
};

export type BusyWindow = { start: string; end: string };

export type PackedPlanItem = PlannerSelection & {
  startsAt: string;
  endsAt: string;
  sequence: number;
  role: TodayPlanRole;
};

export function validateWorkWindows(date: string, windows: WorkWindow[]) {
  const normalized = windows
    .map((window) => ({
      start: toHongKongTimestamp(date, window.start),
      end: toHongKongTimestamp(date, window.end)
    }))
    .sort((left, right) => left.start.localeCompare(right.start));

  for (let index = 0; index < normalized.length; index += 1) {
    const window = normalized[index];
    if (new Date(window.end).getTime() <= new Date(window.start).getTime()) {
      throw new Error("工作時段的結束時間必須遲過開始時間。");
    }
    if (index > 0 && normalized[index - 1].end > window.start) {
      throw new Error("工作時段不可重疊。");
    }
  }
  return normalized;
}

export function normalizeSelections(
  selections: PlannerSelection[],
  candidates: PlannerCandidate[],
  maximumItems = 6
) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.taskId, candidate]));
  const used = new Set<string>();
  const normalized: PlannerSelection[] = [];

  for (const selection of selections) {
    const candidate = candidateById.get(selection.taskId);
    if (!candidate || used.has(selection.taskId) || normalized.length >= maximumItems) continue;
    used.add(selection.taskId);
    normalized.push({
      taskId: selection.taskId,
      suggestedMinutes: Math.max(5, Math.min(240, selection.suggestedMinutes || candidate.minutes)),
      reason: selection.reason.trim().slice(0, 180) || candidate.reasons[0] || "最適合目前容量",
      firstStep: selection.firstStep.trim().slice(0, 240)
        || candidate.nextAction
        || `先打開「${candidate.title}」需要的資料`,
      effortTip: selection.effortTip?.trim().slice(0, 180) || null
    });
  }
  return normalized;
}

export function rulesFallbackSelections(candidates: PlannerCandidate[], maximumItems = 6) {
  return candidates.slice(0, maximumItems).map((candidate) => ({
    taskId: candidate.taskId,
    suggestedMinutes: candidate.minutes,
    reason: candidate.reasons.join("、").slice(0, 180) || "按限期、風險及容量排序",
    firstStep: candidate.nextAction || `先打開「${candidate.title}」需要的資料`,
    effortTip: candidate.minutes > 25 ? "先做一段 25 分鐘；未完成就保存 Checkpoint。" : "只需要完成眼前呢一步。"
  }));
}

export function packPlanIntoWindows(input: {
  date: string;
  workWindows: WorkWindow[];
  busyWindows?: BusyWindow[];
  bufferMinutes: number;
  selections: PlannerSelection[];
}) {
  const available = subtractBusyWindows(
    validateWorkWindows(input.date, input.workWindows),
    input.busyWindows ?? []
  );
  const buffered = reserveBuffer(available, input.bufferMinutes);
  const result: PackedPlanItem[] = [];
  let segmentIndex = 0;
  let cursor = buffered[0]?.start ?? "";
  let laterCount = 0;
  let quickWinCount = 0;

  for (const selection of input.selections) {
    const role: TodayPlanRole = result.length === 0
      ? "now"
      : selection.suggestedMinutes <= 15 && quickWinCount < 3
        ? "quick_win"
        : laterCount < 2
          ? "later"
          : "quick_win";
    if (role === "quick_win" && (selection.suggestedMinutes > 15 || quickWinCount >= 3)) {
      continue;
    }

    let remaining = selection.suggestedMinutes;
    let roleCounted = false;
    while (segmentIndex < buffered.length) {
      const segment = buffered[segmentIndex];
      if (!cursor || cursor < segment.start) cursor = segment.start;
      const segmentMinutes = minutesBetween(cursor, segment.end);
      if (segmentMinutes < Math.min(remaining, 5)) {
        segmentIndex += 1;
        cursor = buffered[segmentIndex]?.start ?? "";
        continue;
      }
      const laterSegmentCanFitWholeTask = segmentMinutes < remaining
        && buffered.slice(segmentIndex + 1).some((later) => minutesBetween(later.start, later.end) >= remaining);
      if (laterSegmentCanFitWholeTask) {
        segmentIndex += 1;
        cursor = buffered[segmentIndex]?.start ?? "";
        continue;
      }
      const allocated = Math.min(remaining, segmentMinutes);
      if (allocated < 5) break;
      const end = addMinutes(cursor, allocated);
      result.push({
        ...selection,
        suggestedMinutes: allocated,
        startsAt: cursor,
        endsAt: end,
        sequence: result.length + 1,
        role
      });
      if (!roleCounted) {
        if (role === "later") laterCount += 1;
        if (role === "quick_win") quickWinCount += 1;
        roleCounted = true;
      }
      cursor = end;
      remaining -= allocated;
      if (remaining <= 0) break;
      segmentIndex += 1;
      cursor = buffered[segmentIndex]?.start ?? "";
    }
    if (remaining > 0) break;
  }
  return result;
}

function subtractBusyWindows(
  available: Array<{ start: string; end: string }>,
  busy: BusyWindow[]
) {
  let segments = available;
  for (const blocked of busy) {
    const blockedStart = new Date(blocked.start).getTime();
    const blockedEnd = new Date(blocked.end).getTime();
    if (!Number.isFinite(blockedStart) || !Number.isFinite(blockedEnd) || blockedEnd <= blockedStart) continue;
    segments = segments.flatMap((segment) => {
      const start = new Date(segment.start).getTime();
      const end = new Date(segment.end).getTime();
      if (blockedEnd <= start || blockedStart >= end) return [segment];
      const next: Array<{ start: string; end: string }> = [];
      if (blockedStart > start) next.push({ start: segment.start, end: new Date(blockedStart).toISOString() });
      if (blockedEnd < end) next.push({ start: new Date(blockedEnd).toISOString(), end: segment.end });
      return next;
    });
  }
  return segments.filter((segment) => minutesBetween(segment.start, segment.end) >= 5);
}

function reserveBuffer(segments: Array<{ start: string; end: string }>, requestedMinutes: number) {
  const result = segments.map((segment) => ({ ...segment }));
  let remaining = Math.max(0, requestedMinutes);
  for (let index = result.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const minutes = minutesBetween(result[index].start, result[index].end);
    const reduction = Math.min(remaining, Math.max(0, minutes - 5));
    result[index].end = addMinutes(result[index].end, -reduction);
    remaining -= reduction;
  }
  return result.filter((segment) => minutesBetween(segment.start, segment.end) >= 5);
}

function toHongKongTimestamp(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("工作時段格式不正確。");
  return parsed.toISOString();
}

function minutesBetween(start: string, end: string) {
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

function addMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}
