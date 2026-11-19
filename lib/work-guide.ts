import type { PersonalTaskTag, Task, TaskStep } from "./types.ts";
import { currentTaskStep } from "./task-steps.ts";

export function defaultCaptureTag(tags: PersonalTaskTag[], preferred?: string | null) {
  return tags.find(t => t.id === preferred) ?? tags.find(t => t.legacy_key === "personal" || t.name === "個人") ?? tags[0] ?? null;
}

export type GuideCheckpoint = { current_position: string | null; next_minimum_step: string | null; completed_summary: string | null };
export type GuideDetail = { checkpoint: GuideCheckpoint | null; steps: Pick<TaskStep,"id"|"title"|"status"|"updated_at"|"sort_order">[]; openChildren: boolean };
export const guideReview = "開工導航：呢一步已做完，等你決定是否結案";
export const guideContinue = "開工導航：下次由呢一步接住";

// Local suggestions only. Nothing is written until the person confirms a step.
export function starterSteps(title: string): [string,string,string] {
  if (/回覆|覆.*訊息|電郵|email|whatsapp/i.test(title)) return ["打開要覆嗰個對話，搵返對方最後一條問題。","寫一句回覆草稿，未使送出。","只打開嗰個對話。"];
  if (/回條|通告|報名|申請|填表/.test(title)) return ["打開份表或通告，搵到第一格要填嘅位置。","只填第一格，未使交表。","先攞出份表，或者打開個連結。"];
  if (/買|補貨|購物/.test(title)) return ["打開購物清單，寫低第一樣要買嘅嘢。","睇返要買嘅數量，只核對呢一樣。","只打開購物清單。"];
  if (/單張|文件|報告|草稿|草擬|簡報|poster|leaflet/i.test(title)) return ["打開上一版文件，圈出一個要改嘅位置。","喺圈住嘅位置試寫一句，唔使一次改晒。","先搵到份文件，打開就得。"];
  if (/約|安排|會議|預約/.test(title)) return ["打開日曆，搵一個可行嘅時段。","寫低一個建議時間，未使發出。","只打開日曆。"];
  return ["將呢件事會用到嘅第一樣嘢放到手邊，或者打開相關頁面。","用手邊嘅材料做第一小部分；做到一樣就可以停。","先搵到一樣會用到嘅嘢。"];
}

export function guideInstruction(task: Pick<Task,"title"|"next_action">, detail: GuideDetail) {
  const step = currentTaskStep(detail.steps);
  const [starter, follow, smaller] = starterSteps(task.title);
  if (step) return { kind: step.status === "waiting" ? "waiting" : "step", text:step.title, smaller:"先攞出做呢一步需要嘅第一樣嘢，唔使即刻做晒。", follow:"", step } as const;
  const checkpoint=detail.checkpoint;
  if (checkpoint?.next_minimum_step?.trim() && (!detail.steps.length || checkpoint.current_position===guideContinue)) return { kind:"resume", text:checkpoint.next_minimum_step, smaller, follow:"", step:null } as const;
  if (detail.steps.length || checkpoint?.current_position===guideReview) return { kind:"review", text:"呢步已搞掂。成件 Task 可以結案，定係仲有下一步？", smaller:"", follow:"", step:null } as const;
  if (task.next_action?.trim()) return { kind:"next", text:task.next_action, smaller, follow:"", step:null } as const;
  return { kind:"starter", text:starter, smaller, follow, step:null } as const;
}
