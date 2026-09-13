"use client";

import { ListChecks, Rows3, Sparkles } from "lucide-react";

export type ActionCenterTab = "focus" | "today" | "tasks";

const tabs = [
  { id: "focus" as const, label: "今日重點", icon: Sparkles },
  { id: "today" as const, label: "今日全部", icon: ListChecks },
  { id: "tasks" as const, label: "任務總表", icon: Rows3 }
];

export function ActionCenterTabs({
  active,
  todayCount,
  taskCount,
  onChange
}: {
  active: ActionCenterTab;
  todayCount: number;
  taskCount: number;
  onChange: (tab: ActionCenterTab) => void;
}) {
  return (
    <nav className="panel p-2" aria-label="行動中心分頁">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="行動中心內容">
        {tabs.map((tab) => {
          const selected = active === tab.id;
          const Icon = tab.icon;
          const count = tab.id === "today" ? todayCount : tab.id === "tasks" ? taskCount : null;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`action-center-tab-${tab.id}`}
              aria-controls={`action-center-panel-${tab.id}`}
              aria-selected={selected}
              className={`flex min-h-14 items-center justify-center gap-2 rounded-xl px-2 text-sm font-extrabold transition sm:px-4 sm:text-base ${selected ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-800"}`}
              onClick={() => onChange(tab.id)}
            >
              <Icon className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span>{tab.label}</span>
              {count !== null ? (
                <span className={`hidden rounded-full px-2 py-0.5 text-xs sm:inline ${selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
