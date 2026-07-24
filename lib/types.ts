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
  next_action: string | null;
  risk: Risk;
  notes: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  owner_id?: string;
  created_by_id?: string;
  visibility?: Visibility;
  area?: Area;
  description?: string | null;
  assignee_id?: string | null;
  requested_priority?: number;
  planned_date?: string | null;
  estimated_minutes?: number | null;
  actual_minutes?: number | null;
  energy_level?: EnergyLevel | null;
  context?: string | null;
  definition_of_done?: string | null;
  required_information?: string | null;
  blocked_reason?: string | null;
  critical_path?: boolean;
  revenue_impact?: number | null;
  safety_impact?: boolean;
  child_impact?: boolean;
  legal_impact?: boolean;
  last_progress_at?: string | null;
  snoozed_until?: string | null;
  estimated_duration_days?: number | null;
  buffer_days?: number;
  latest_safe_start_date?: string | null;
  progress?: number;
  project_id?: string | null;
  recurrence_rule_id?: string | null;
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
  theme?: "light" | "dark" | "system";
  language?: string;
  accent_colour?: string;
  gentle_mode?: boolean;
  low_capacity_mode?: boolean;
  dashboard_density?: "calm" | "comfortable" | "compact";
  wip_limit?: number;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  notification_mode?: string;
  default_area?: Area;
  focus_minutes?: number;
  monthly_profit_target?: number;
  pinned_pages?: string[];
};

export type Area = "work" | "family" | "personal";
export type Visibility = "private" | "shared" | "assigned" | "joint";
export type EnergyLevel = "low" | "medium" | "high";
export type SharePermission = "view" | "comment" | "update_status" | "edit" | "co_owner";
export type ShareType = "reference" | "assignment" | "joint";

export type UserProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  timezone: string;
  active: boolean;
  is_admin: boolean;
  must_change_password: boolean;
};

export type CurrentUser = { id: string; email: string; displayName: string };

export type OperatingItem = {
  id: string;
  item_type: string;
  title: string;
  description: string | null;
  status: "inbox" | "active" | "waiting" | "blocked" | "review" | "completed" | "cancelled";
  area: Area;
  owner_id: string;
  created_by_id: string;
  assignee_id: string | null;
  visibility: Visibility;
  due_date: string | null;
  next_action: string | null;
  sensitive: boolean;
  metadata: Record<string, unknown>;
  last_progress_at: string | null;
  archived_at: string | null;
  inbox_available_after?: string | null;
  inbox_processed_at?: string | null;
  inbox_processing_event_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type InboxProcessingAction =
  | "do_now"
  | "create_task"
  | "add_project"
  | "add_waiting"
  | "assign"
  | "schedule"
  | "keep_note"
  | "skip";

export type InboxProcessingEvent = {
  id: string;
  inbox_item_id: string;
  action: InboxProcessingAction;
  target_type: "task" | "operating_item" | null;
  target_id: string | null;
  processed_at: string;
  undone_at: string | null;
};

export type InboxProcessingBundle = {
  currentUser: CurrentUser;
  currentItem: OperatingItem | null;
  items: OperatingItem[];
  totalRemaining: number;
  sessionProcessed: number;
  sessionTotal: number;
  position: number;
  participants: Array<{ user_id: string; display_name: string }>;
  lastUndoable: InboxProcessingEvent | null;
  page: number;
  pageSize: number;
};

export type ShareRecord = {
  id: string;
  resource_type: "task" | "operating_item";
  resource_id: string;
  owner_id: string;
  shared_with_user_id: string;
  permission: SharePermission;
  share_type: ShareType;
  include_attachments: boolean;
  include_comments: boolean;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export type AssignmentStatus =
  | "pending_acceptance"
  | "accepted"
  | "declined"
  | "clarification_requested"
  | "alternative_date_proposed"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "completed"
  | "returned"
  | "closed"
  | "cancelled";
export type Assignment = {
  id: string;
  resource_type: "task" | "operating_item";
  resource_id: string;
  assigned_by_id: string;
  assigned_to_id: string;
  status: AssignmentStatus;
  due_date: string | null;
  requested_priority: number;
  definition_of_done: string | null;
  instructions: string | null;
  decline_reason: string | null;
  proposed_date: string | null;
  accepted_at: string | null;
  completed_at?: string | null;
  parent_assignment_id?: string | null;
  handoff_sequence?: number;
  progress?: number;
  completed_steps?: number;
  next_step?: string | null;
  waiting_until?: string | null;
  step_outcome?: "continue" | "returned" | "closed" | null;
  returned_at?: string | null;
  closed_at?: string | null;
  last_note_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type HandoffNote = {
  id: string;
  assignment_id: string;
  task_id: string;
  author_id: string;
  event_type: "assigned" | "accepted" | "declined" | "clarification" | "progress" | "waiting" | "blocked" | "step_completed" | "returned" | "closed" | "comment";
  body: string;
  progress: number | null;
  next_step: string | null;
  waiting_until: string | null;
  created_at: string;
};

export type TaskDependency = {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_by_id: string;
  created_at: string;
};

export type ProjectMilestone = {
  id: string;
  project_id: string;
  created_by_id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: "active" | "blocked" | "completed" | "cancelled";
  critical: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "custom";

export type TaskRecurrenceRule = {
  id: string;
  seed_task_id: string;
  owner_id: string;
  created_by_id: string;
  frequency: RecurrenceFrequency;
  weekdays: number[];
  custom_interval_days: number | null;
  business_days_only: boolean;
  night_shift_pattern: boolean;
  night_shift_on_days: number | null;
  night_shift_off_days: number | null;
  cycle_anchor_date: string | null;
  template: Record<string, unknown>;
  is_active: boolean;
  last_generated_at: string | null;
  last_generated_for: string | null;
  created_at: string;
  updated_at: string;
};

export type CapacityCheckin = {
  id: string;
  user_id: string;
  checkin_date: string;
  energy_level: EnergyLevel;
  available_minutes: number | null;
  mode: "normal" | "gentle" | "minimum_step" | "shift";
  essential_only: boolean;
  rest_day?: boolean;
  notes: string | null;
};

export type TodayPlanRole = "now" | "later" | "quick_win";

export type PlanningMetadata = {
  user_id: string;
  resource_type: string;
  resource_id: string;
  personal_priority: number;
  planned_date: string | null;
  snoozed_until: string | null;
  pinned: boolean;
  hidden_from_today: boolean;
  plan_role?: TodayPlanRole | null;
  plan_source?: "manual" | "auto_plan" | null;
  accepted_at?: string | null;
  plan_token?: string | null;
};

export type TaskCheckpointResource = {
  label: string;
  url: string;
};

export type TaskCheckpoint = {
  id: string;
  task_id: string;
  author_id: string;
  state: "draft" | "saved";
  completed_summary: string | null;
  current_position: string | null;
  next_minimum_step: string | null;
  resource_links: TaskCheckpointResource[];
  blocked_reason: string | null;
  last_worked_at: string;
  created_at: string;
  updated_at: string;
};

export type TaskCheckpointBundle = {
  latest: TaskCheckpoint | null;
  draft: TaskCheckpoint | null;
  history: TaskCheckpoint[];
};

export type NotificationPreferences = {
  user_id: string;
  browser_enabled: boolean;
  today_first_enabled: boolean;
  deadline_enabled: boolean;
  waiting_enabled: boolean;
  handover_enabled: boolean;
  focus_enabled: boolean;
  shutdown_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  night_shift_mode: boolean;
  timezone: string;
  today_reminder_time: string;
  shutdown_reminder_time: string;
  deadline_lead_minutes: number;
  private_on_lock_screen: boolean;
  created_at: string;
  updated_at: string;
};

export type NotificationKind =
  | "today_first"
  | "deadline"
  | "waiting_followup"
  | "handover_received"
  | "handover_accepted"
  | "handover_information"
  | "handover_returned"
  | "handover_completed"
  | "focus_complete"
  | "daily_shutdown"
  | "test";

export type NotificationDelivery = {
  id: string;
  kind: NotificationKind;
  deliver_at: string;
  status: "scheduled" | "processing" | "retry" | "sent" | "opened" | "failed" | "cancelled";
  generic_title: string;
  generic_body: string;
  target_path: string;
  sent_at: string | null;
  opened_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
  created_at: string;
};

export type ControlData = AppData & {
  currentUser: CurrentUser;
  profile: UserProfile;
  settings: UserSettings;
  operatingItems: OperatingItem[];
  shares: ShareRecord[];
  assignments: Assignment[];
  handoffNotes: HandoffNote[];
  planning: PlanningMetadata[];
  capacity: CapacityCheckin | null;
  participants: Array<{ user_id: string; display_name: string }>;
  taskDependencies: TaskDependency[];
  projectMilestones: ProjectMilestone[];
  taskRecurrenceRules: TaskRecurrenceRule[];
  notificationPreferences: NotificationPreferences | null;
  notificationDeliveries: NotificationDelivery[];
  activePushSubscriptionCount: number;
};

export type TodayData = {
  currentUser: CurrentUser;
  profile: UserProfile;
  settings: UserSettings;
  tasks: Task[];
  shares: ShareRecord[];
  assignments: Assignment[];
  planning: PlanningMetadata[];
  capacity: CapacityCheckin | null;
  participants: Array<{ user_id: string; display_name: string }>;
  taskDependencies: TaskDependency[];
};

export type AppData = {
  tasks: Task[];
  transactions: Transaction[];
  meetings: Meeting[];
  balances: Balance[];
  settings: UserSettings | null;
};
