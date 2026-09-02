import type { Risk, WorkflowTaskType } from "@/lib/types";

export type HandoffPreview = {
  title: string;
  nextAction: string;
  ownerId: string;
  ownerName: string;
  dueDate: string;
  needsDecisionFromId: string;
  needsDecisionFromName: string;
  risk: Risk;
  taskType: string;
  originalText: string;
};

type Participant = { user_id: string; display_name: string };

const inferredTaskTypeLabels: Record<WorkflowTaskType, string> = {
  general: "一般工作",
  intake: "待整理",
  scheduling: "時間安排",
  materials: "文件整理",
  rn_coordination: "等待別人",
  follow_up: "跟進",
  sop: "工作流程",
  ai_document: "文件草稿",
  system_issue: "系統工作",
  compliance: "檢查事項",
  training: "學習及進修",
  assessment: "等待覆核",
  family_conference: "會議工作"
};

const weekDays: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6
};

export function parseHandoffText(input: {
  text: string;
  participants: Participant[];
  currentUserId: string;
  currentUserName: string;
  today?: string;
}): HandoffPreview {
  const text = input.text.trim().replace(/\s+/g, " ");
  const participants = uniqueParticipants([
    ...input.participants,
    { user_id: input.currentUserId, display_name: input.currentUserName }
  ]);
  const owner = findMentionedParticipant(text, participants)
    ?? participants.find((person) => person.user_id === input.currentUserId)!;
  const decision = decisionParticipant(text, participants, input.currentUserId);
  const dueDate = extractDueDate(text, input.today ?? localDateIso(new Date()));
  const taskType = inferTaskType(text);
  const risk: Risk = /立即|即時|緊急|安全|high risk/i.test(text) ? "high" : dueDate ? "medium" : "low";

  return {
    title: inferTitle(text, taskType),
    nextAction: inferNextAction(text, owner.display_name),
    ownerId: owner.user_id,
    ownerName: owner.display_name,
    dueDate,
    needsDecisionFromId: decision?.user_id ?? "",
    needsDecisionFromName: decision?.display_name ?? "",
    risk,
    taskType: inferredTaskTypeLabels[taskType],
    originalText: text
  };
}

export function isLikelyDuplicate(
  preview: Pick<HandoffPreview, "title" | "dueDate">,
  existing: Array<{ title: string; due_date?: string | null }>
) {
  const title = normalize(preview.title);
  return existing.some((task) => {
    const sameDate = !preview.dueDate || !task.due_date || preview.dueDate === task.due_date;
    return sameDate && title.length >= 4 && titleSimilarity(task.title, preview.title);
  });
}

function findMentionedParticipant(text: string, participants: Participant[]) {
  const lower = text.toLowerCase();
  return participants.find((person) => person.display_name.toLowerCase()
    .split(/[\s_\-@]+/)
    .filter((part) => part.length >= 2)
    .some((name) => lower.includes(name)));
}

function decisionParticipant(text: string, participants: Participant[], currentUserId: string) {
  if (!/確認|決定|覆核|approve|review/i.test(text)) return null;
  if (/要我確認|由我確認|我決定/.test(text)) {
    return participants.find((person) => person.user_id === currentUserId) ?? null;
  }
  return findMentionedParticipant(text, participants)
    ?? participants.find((person) => person.user_id === currentUserId)
    ?? null;
}

function extractDueDate(text: string, today: string) {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const short = text.match(/(?<!\d)(\d{1,2})月(\d{1,2})日?/);
  if (short) return `${today.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  if (/今日|今天/.test(text)) return today;
  if (/聽日|明天/.test(text)) return addDays(today, 1);
  const weekday = text.match(/(?:星期|禮拜|週)([一二三四五六日天])/);
  if (weekday) {
    const target = weekDays[weekday[1]];
    const current = new Date(`${today}T12:00:00+08:00`).getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  return "";
}

function inferTaskType(text: string): WorkflowTaskType {
  if (/SOP|流程|程序/i.test(text)) return "sop";
  if (/系統|bug|錯誤|error/i.test(text)) return "system_issue";
  if (/檢查|核對|覆核|review/i.test(text)) return "assessment";
  if (/學習|進修|training|培訓|教材/i.test(text)) return "training";
  if (/草稿|文件|整理/i.test(text)) return "ai_document";
  if (/會議|meeting/i.test(text)) return "family_conference";
  if (/安排|時間|schedule/i.test(text)) return "scheduling";
  if (/跟進|follow.?up|問|聯絡|回覆|等待/i.test(text)) return "follow_up";
  return "general";
}

function inferTitle(text: string, taskType: string) {
  const first = text.split(/[。！？!?]/)[0].trim();
  if (first.length <= 80) return first;
  const fallback = taskType === "general" ? "工作交接" : "整理工作交接";
  return `${first.slice(0, 72)}…` || fallback;
}

function inferNextAction(text: string, ownerName: string) {
  const clauses = text.split(/[，。,；;]/).map((part) => part.trim()).filter(Boolean);
  const ownerClause = clauses.find((part) => part.toLowerCase().includes(ownerName.toLowerCase()));
  return (ownerClause ?? clauses[1] ?? clauses[0] ?? "先確認要做的第一步").slice(0, 300);
}

function uniqueParticipants(participants: Participant[]) {
  return [...new Map(participants.map((person) => [person.user_id, person])).values()];
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[\s，。,:：;；_-]+/g, "");
}

function titleSimilarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a.length >= 4 && b.length >= 4 && (a === b || a.includes(b) || b.includes(a));
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateIso(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}
