import type {
  ExpenseStatus,
  Frequency,
  IncomeStatus,
  ReminderDays,
  Risk,
  Scope,
  SourceType,
  TaskStatus,
  TransactionStatus,
  TransactionType
} from "@/lib/types";

export const scopeLabels: Record<Scope, string> = {
  home: "家庭",
  company: "公司"
};

export const sourceTypeLabels: Record<SourceType, string> = {
  meeting_action: "會後工作",
  deadline: "死線",
  follow_up: "跟進"
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  not_started: "未完成",
  in_progress: "未完成",
  waiting: "未完成",
  done: "已完成",
  blocked: "未完成",
  cancelled: "已取消"
};

export const taskStatusDetailLabels: Record<TaskStatus, string> = {
  not_started: "未開始",
  in_progress: "進行中",
  waiting: "等待中",
  done: "已完成",
  blocked: "有問題",
  cancelled: "已取消"
};

export const riskLabels: Record<Risk, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

export const transactionTypeLabels: Record<TransactionType, string> = {
  income: "收入",
  expense: "支出"
};

export const frequencyLabels: Record<Frequency, string> = {
  monthly: "每月",
  one_time: "一次性",
  irregular: "不定期"
};

export const incomeStatusLabels: Record<IncomeStatus, string> = {
  expected: "預計收入",
  received: "已收到",
  delayed: "延遲",
  problem: "有問題",
  cancelled: "已取消"
};

export const expenseStatusLabels: Record<ExpenseStatus, string> = {
  unpaid: "未付款",
  paid: "已付款",
  problem: "有問題",
  skipped: "跳過",
  cancelled: "已取消"
};

export const transactionStatusLabels: Record<TransactionStatus, string> = {
  ...incomeStatusLabels,
  ...expenseStatusLabels
};

export const reminderDayLabels: Record<ReminderDays, string> = {
  7: "7 日",
  3: "3 日",
  1: "1 日"
};

export const scopeOptions = [
  { value: "home", label: "家庭" },
  { value: "company", label: "公司" }
] as const;

export const sourceTypeOptions = [
  { value: "meeting_action", label: "會後工作" },
  { value: "deadline", label: "死線" },
  { value: "follow_up", label: "跟進" }
] as const;

export const taskStatusOptions = [
  { value: "not_started", label: "未完成" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" }
] as const;

export const taskStatusFilterOptions = [
  { value: "unfinished", label: "未完成" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" }
] as const;

export const unfinishedTaskStatuses = ["not_started", "in_progress", "waiting", "blocked"] as const;

export const riskOptions = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
] as const;

export const frequencyOptions = [
  { value: "monthly", label: "每月" },
  { value: "one_time", label: "一次性" },
  { value: "irregular", label: "不定期" }
] as const;

export const incomeStatusOptions = [
  { value: "expected", label: "預計收入" },
  { value: "received", label: "已收到" },
  { value: "delayed", label: "延遲" },
  { value: "problem", label: "有問題" },
  { value: "cancelled", label: "已取消" }
] as const;

export const expenseStatusOptions = [
  { value: "unpaid", label: "未付款" },
  { value: "paid", label: "已付款" },
  { value: "problem", label: "有問題" },
  { value: "skipped", label: "跳過" },
  { value: "cancelled", label: "已取消" }
] as const;
