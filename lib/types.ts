export type Scope = "home" | "company";
export type SourceType = "meeting_action" | "deadline" | "follow_up";
export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "waiting"
  | "done"
  | "blocked"
  | "cancelled";
export type Risk = "low" | "medium" | "high";
export type TransactionType = "income" | "expense";
export type Frequency = "monthly" | "one_time" | "irregular";
export type IncomeStatus = "expected" | "received" | "delayed" | "problem" | "cancelled";
export type ExpenseStatus = "unpaid" | "paid" | "problem" | "skipped" | "cancelled";
export type TransactionStatus = IncomeStatus | ExpenseStatus;
export type ReminderDays = 7 | 3 | 1;

export type Task = {
  id: string;
  user_id: string;
  scope: Scope;
  source_type: SourceType;
  title: string;
  owner: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  status: TaskStatus;
  next_action: string;
  risk: Risk;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  user_id: string;
  scope: Scope;
  type: TransactionType;
  item: string;
  category: string | null;
  amount: number;
  expected_date: string | null;
  actual_date: string | null;
  frequency: Frequency;
  status: TransactionStatus;
  payment_method: string | null;
  owner: string | null;
  proof_url: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Meeting = {
  id: string;
  user_id: string;
  scope: Scope;
  meeting_name: string;
  meeting_date: string;
  raw_notes: string | null;
  summary: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Balance = {
  id: string;
  user_id: string;
  scope: Scope;
  month: string;
  opening_balance: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserSettings = {
  id: string;
  user_id: string;
  email: string | null;
  daily_reminder_time: string;
  default_reminder_days: ReminderDays;
  created_at: string;
  updated_at: string;
};

export type AppData = {
  tasks: Task[];
  transactions: Transaction[];
  meetings: Meeting[];
  balances: Balance[];
  settings: UserSettings | null;
};
