import type { Risk, WorkflowTaskType } from "@/lib/types";

export type HandoffPreview = {
  caseCode: string;
  title: string;
  nextAction: string;
  ownerId: string;
  ownerName: string;
  dueDate: string;
  materialsRequired: string;
  rnRequired: boolean;
  clientUpdateRequired: boolean;
  needsDecisionFromId: string;
  needsDecisionFromName: string;
  risk: Risk;
  taskType: WorkflowTaskType;
  originalText: string;
};

type Participant = { user_id: string; display_name: string };

const weekDays: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6
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
  const owner = findMentionedParticipant(text, participants) ?? participants.find((person) => person.user_id === input.currentUserId)!;
  const decision = decisionParticipant(text, participants, input.currentUserId);
  const dueDate = extractDueDate(text, input.today ?? localDateIso(new Date()));
  const caseCode = extractCaseCode(text);
  const materialsRequired = extractMaterials(text);
  const rnRequired = /\bRN\b|護士|護理員|安排.{0,8}(?:RN|護士)/i.test(text);
  const clientUpdateRequired = /家屬|客人|客戶|client|family/i.test(text) && /回覆|聯絡|通知|update|確認/i.test(text);
  const taskType = inferTaskType(text, { rnRequired, materialsRequired });
  const risk: Risk = /急症|即時|緊急|危險|安全|high risk/i.test(text) ? "high" : dueDate ? "medium" : "low";
  const title = inferTitle(text, caseCode, taskType);

  return {
    caseCode,
    title,
    nextAction: inferNextAction(text, owner.display_name),
    ownerId: owner.user_id,
    ownerName: owner.display_name,
    dueDate,
    materialsRequired,
    rnRequired,
    clientUpdateRequired,
    needsDecisionFromId: decision?.user_id ?? "",
    needsDecisionFromName: decision?.display_name ?? "",
    risk,
    taskType,
    originalText: text
  };
}

export function isLikelyDuplicate(
  preview: Pick<HandoffPreview, "title" | "caseCode" | "dueDate">,
  existing: Array<{ title: string; case_code?: string | null; due_date?: string | null }>
) {
  const title = normalize(preview.title);
  const caseCode = normalize(preview.caseCode);
  return existing.some((task) => {
    const sameTitle = title.length >= 4 && normalize(task.title) === title;
    const sameCase = caseCode && normalize(task.case_code ?? "") === caseCode;
    const sameDate = !preview.dueDate || !task.due_date || preview.dueDate === task.due_date;
    return sameDate && (sameTitle || (sameCase && titleSimilarity(task.title, preview.title)));
  });
}

function findMentionedParticipant(text: string, participants: Participant[]) {
  const lower = text.toLowerCase();
  return participants.find((person) => {
    const names = person.display_name.toLowerCase().split(/[\s_\-@]+/).filter((part) => part.length >= 2);
    return names.some((name) => lower.includes(name));
  });
}

function decisionParticipant(text: string, participants: Participant[], currentUserId: string) {
  if (!/確認|決定|覆核|approve|review/i.test(text)) return null;
  if (/要我確認|由我確認|我決定/.test(text)) {
    return participants.find((person) => person.user_id === currentUserId) ?? null;
  }
  const matched = findMentionedParticipant(text, participants);
  return matched ?? participants.find((person) => person.user_id === currentUserId) ?? null;
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

function extractCaseCode(text: string) {
  const labelled = text.match(/(?:個案|case|病人代號)\s*[:：#]?\s*([A-Za-z0-9_-]{2,24})/i);
  if (labelled) return labelled[1];
  const chineseName = text.match(/^([\u3400-\u9fff]{1,4}(?:先生|太太|太|小姐|婆婆|伯伯))/);
  return chineseName?.[1] ?? "";
}

function extractMaterials(text: string) {
  const match = text.match(/(?:準備|物資|materials?)\s*[:：]?\s*([^，。,；;]{2,80})/i);
  return match?.[1]?.trim() ?? "";
}

function inferTaskType(text: string, derived: { rnRequired: boolean; materialsRequired: string }): WorkflowTaskType {
  if (/SOP/i.test(text)) return "sop";
  if (/系統|bug|錯誤|error/i.test(text)) return "system_issue";
  if (/compliance|CCSV|合規/i.test(text)) return "compliance";
  if (/training|培訓|教材/i.test(text)) return "training";
  if (/AI|草稿|文件覆核/i.test(text)) return "ai_document";
  if (/assessment|評估/i.test(text)) return "assessment";
  if (/family conference|家屬會議/i.test(text)) return "family_conference";
  if (/intake|收症|新症/i.test(text)) return "intake";
  if (derived.materialsRequired) return "materials";
  if (derived.rnRequired) return "rn_coordination";
  if (/schedule|安排|時間/i.test(text)) return "scheduling";
  if (/跟進|follow.?up|問|聯絡|回覆/i.test(text)) return "follow_up";
  return "general";
}

function inferTitle(text: string, caseCode: string, taskType: WorkflowTaskType) {
  const first = text.split(/[。！？!?]/)[0].trim();
  if (first.length <= 80) return first;
  const prefix = caseCode ? `${caseCode}：` : "";
  const label = taskType === "general" ? "工作交接" : taskType.replaceAll("_", " ");
  return `${prefix}${label}`.slice(0, 80);
}

function inferNextAction(text: string, ownerName: string) {
  const clauses = text.split(/[，。,；;]/).map((part) => part.trim()).filter(Boolean);
  const ownerClause = clauses.find((part) => part.toLowerCase().includes(ownerName.toLowerCase()));
  return (ownerClause ?? clauses[1] ?? clauses[0] ?? "先確認交接內容").slice(0, 300);
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
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateIso(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
