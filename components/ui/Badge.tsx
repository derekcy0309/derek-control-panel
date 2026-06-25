import clsx from "clsx";
import type { Risk, Scope, TaskStatus, TransactionStatus } from "@/lib/types";
import { riskLabels, scopeLabels, taskStatusLabels, transactionStatusLabels } from "@/lib/labels";

export function ScopeBadge({ scope }: { scope: Scope }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold",
        scope === "home" ? "bg-home-100 text-home-700" : "bg-work-100 text-work-700"
      )}
    >
      {scopeLabels[scope]}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold",
        risk === "high" && "bg-red-100 text-red-700",
        risk === "medium" && "bg-orange-100 text-orange-700",
        risk === "low" && "bg-emerald-50 text-emerald-700"
      )}
    >
      風險：{riskLabels[risk]}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus | TransactionStatus }) {
  const label =
    status in taskStatusLabels
      ? taskStatusLabels[status as TaskStatus]
      : transactionStatusLabels[status as TransactionStatus];

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold",
        (status === "blocked" || status === "problem") && "bg-red-100 text-red-700",
        (status === "waiting" || status === "delayed" || status === "unpaid" || status === "expected") &&
          "bg-yellow-100 text-yellow-800",
        (status === "done" || status === "received" || status === "paid") && "bg-emerald-100 text-emerald-700",
        (status === "cancelled" || status === "skipped") && "bg-slate-100 text-slate-600",
        status === "in_progress" && "bg-indigo-100 text-indigo-700",
        status === "not_started" && "bg-slate-100 text-slate-700"
      )}
    >
      {label}
    </span>
  );
}
