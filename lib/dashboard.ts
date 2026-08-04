import type { Task, Transaction } from "@/lib/types";
import { isOverdue, isWithinDays } from "@/lib/date";

export type FocusItem =
  | { kind: "task"; score: number; title: string; task: Task }
  | { kind: "transaction"; score: number; title: string; transaction: Transaction };

function taskScore(task: Task) {
  const due = task.due_date;
  const followUp = task.follow_up_date;
  const recurrencePrompt = task.recurrence_rule_id ? task.planned_date : null;
  let score = 0;

  if (task.status === "blocked") score += 1000;
  if (isOverdue(due)) score += 900;
  if (isWithinDays(due, 0)) score += 800;
  if (isWithinDays(due, 3)) score += 700;
  if (task.risk === "high") score += 400;
  if (task.scope === "company" && /收入|收款|付款|客戶|合約/.test(`${task.title}${task.notes ?? ""}`)) score += 300;
  if (task.scope === "home" && /債|付款|租|供款|保費|學費/.test(`${task.title}${task.notes ?? ""}`)) score += 250;
  if (isWithinDays(followUp, 0)) score += 200;
  if (isWithinDays(recurrencePrompt, 0) || isOverdue(recurrencePrompt)) score += 200;
  if (task.status === "done" || task.status === "cancelled") score -= 1000;

  return score;
}

function transactionScore(transaction: Transaction) {
  let score = 0;
  if (transaction.type === "expense" && isWithinDays(transaction.expected_date, 3) && transaction.status !== "paid") score += 600;
  if (transaction.type === "income" && transaction.status === "delayed") score += 500;
  if (transaction.status === "problem") score += 1000;
  if (transaction.status === "cancelled" || transaction.status === "paid" || transaction.status === "received") score -= 1000;
  return score;
}

export function getFocusItems(tasks: Task[], transactions: Transaction[]) {
  const taskItems: FocusItem[] = tasks.map((task) => ({
    kind: "task",
    score: taskScore(task),
    title: task.title,
    task
  }));

  const transactionItems: FocusItem[] = transactions.map((transaction) => ({
    kind: "transaction",
    score: transactionScore(transaction),
    title: transaction.item,
    transaction
  }));

  return [...taskItems, ...transactionItems]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function getProblemItems(tasks: Task[], transactions: Transaction[]) {
  return {
    tasks: tasks.filter((task) => task.status === "blocked"),
    transactions: transactions.filter((item) => item.status === "problem")
  };
}

export function getOverdueTasks(tasks: Task[]) {
  return tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      (isOverdue(task.due_date) || isOverdue(task.follow_up_date))
  );
}

export function getTodayFollowUps(tasks: Task[]) {
  return tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      (isWithinDays(task.follow_up_date, 0) || isWithinDays(task.due_date, 0)
        || Boolean(task.recurrence_rule_id && task.planned_date && (isWithinDays(task.planned_date, 0) || isOverdue(task.planned_date))))
  );
}

export function getUpcomingTransactions(transactions: Transaction[], days = 7) {
  return transactions.filter(
    (item) =>
      item.status !== "cancelled" &&
      item.status !== "paid" &&
      item.status !== "received" &&
      isWithinDays(item.expected_date, days)
  );
}
