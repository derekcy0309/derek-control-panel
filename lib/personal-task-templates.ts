import type { SourceType } from "@/lib/types";

export type PersonalTaskTemplate = {
  id: string;
  label: string;
  title: string;
  nextAction: string;
  sourceType: SourceType;
};

export const personalTaskTemplates: PersonalTaskTemplate[] = [
  { id: "meeting-followup", label: "會議後跟進", title: "跟進會議行動", nextAction: "打開會議 notes，揀出第一個要完成的行動", sourceType: "meeting_action" },
  { id: "waiting-document", label: "等待文件", title: "等待文件", nextAction: "確認尚欠哪份文件及下次跟進日期", sourceType: "follow_up" },
  { id: "waiting-decision", label: "等待別人決定", title: "等待決定", nextAction: "寫清楚等待誰、等甚麼及何時再問", sourceType: "follow_up" },
  { id: "weekly-admin", label: "每週行政工作", title: "每週行政工作", nextAction: "打開清單，只完成第一項", sourceType: "follow_up" },
  { id: "monthly-finance", label: "每月財務檢查", title: "每月財務檢查", nextAction: "打開財務頁，先核對一項未付或未收紀錄", sourceType: "follow_up" },
  { id: "social-post", label: "社交媒體出 Post", title: "準備社交媒體 Post", nextAction: "先寫一句重點及選一張圖", sourceType: "deadline" },
  { id: "personal-learning", label: "個人學習及進修", title: "個人學習及進修", nextAction: "打開教材，完成 15 分鐘第一節", sourceType: "follow_up" }
];
