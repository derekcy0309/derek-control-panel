export type WrittenChannel = "whatsapp" | "email";

export type ReplyTemplateId =
  | "appointment_confirmation"
  | "waiting_patient_information"
  | "nurse_arranging"
  | "materials_confirmation"
  | "payment_reminder"
  | "service_time_change";

export type ReplyTemplate = {
  id: ReplyTemplateId;
  label: string;
  emailSubject: string;
  message: string;
};

export const replyTemplates: ReplyTemplate[] = [
  {
    id: "appointment_confirmation",
    label: "確認預約",
    emailSubject: "預約確認",
    message: "想同你確認服務預約安排。如以下日期及時間合適，請回覆確認；如需要改動亦可以直接用文字告訴我們。"
  },
  {
    id: "waiting_patient_information",
    label: "等待病人資料",
    emailSubject: "尚待資料以便跟進",
    message: "我們已開始跟進，目前尚待所需資料。收到後會繼續處理，毋須致電追問；你可以直接用文字補充。"
  },
  {
    id: "nurse_arranging",
    label: "護士安排中",
    emailSubject: "護士安排進度",
    message: "護士安排正在處理中，確認人選及時間後會再以文字通知你。現階段暫時不需要額外行動。"
  },
  {
    id: "materials_confirmation",
    label: "物資確認",
    emailSubject: "物資確認",
    message: "想確認服務所需物資是否已準備妥當。如仍有欠缺，請直接回覆物資名稱及數量，我們會再跟進。"
  },
  {
    id: "payment_reminder",
    label: "付款提醒",
    emailSubject: "款項跟進",
    message: "溫馨提示有一項款項尚待確認。如已完成付款，請回覆付款日期或憑證；如需要協助亦可以直接以文字告訴我們。"
  },
  {
    id: "service_time_change",
    label: "更改服務時間",
    emailSubject: "服務時間更改",
    message: "服務時間需要作出調整。請查看以下建議時間並回覆是否合適；收到確認前，我們不會把建議時間當作已落實。"
  }
];

export function summarizeWrittenMessage(value: string) {
  const normalized = value.replace(/\r/g, "\n").replace(/[\t ]+/g, " ").trim();
  if (!normalized) return "請貼入收到的訊息；系統只會在本機以固定規則整理，不會傳送至外部 AI。";
  const sentences = normalized
    .split(/(?:\n+|[。！？!?；;]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = (sentences.length ? sentences : [normalized]).slice(0, 3);
  const summary = selected.map((item) => item.slice(0, 110)).join("；");
  return summary.length > 280 ? `${summary.slice(0, 277)}…` : summary;
}

export function createWrittenReply(input: {
  templateId: ReplyTemplateId;
  recipient?: string;
  timing?: string;
  extra?: string;
}) {
  const template = replyTemplates.find((item) => item.id === input.templateId) ?? replyTemplates[0];
  const greeting = input.recipient?.trim() ? `${input.recipient.trim()}你好，` : "你好，";
  const timing = input.timing?.trim() ? `\n\n日期／時間：${input.timing.trim()}` : "";
  const extra = input.extra?.trim() ? `\n\n補充：${input.extra.trim()}` : "";
  return {
    subject: template.emailSubject,
    body: `${greeting}\n\n${template.message}${timing}${extra}\n\n謝謝。`
  };
}
