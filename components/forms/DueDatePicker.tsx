"use client";

import { CalendarDays, X } from "lucide-react";
import { duePriorityBand, shiftIsoDate, type PriorityBand } from "@/lib/due-priority";
import { hkDateIso } from "@/lib/planning";

const quickDates = [7, 14, 21, 30] as const;

export function DueDatePicker({ value, onChange, disabled = false, label = "到期日（可留空）" }: {
  value: string;
  onChange: (value: string, priority: PriorityBand | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const today = hkDateIso();
  const band = duePriorityBand(value, today);

  function choose(date: string) {
    onChange(date, duePriorityBand(date, today));
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="label">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2" aria-label="快速選擇到期日">
        {quickDates.map((days) => {
          const date = shiftIsoDate(today, days);
          const selected = value === date;
          return (
            <button
              key={days}
              type="button"
              className={`due-quick-button due-quick-${days} ${selected ? "is-selected" : ""}`}
              onClick={() => choose(date)}
            >
              {days} 日
            </button>
          );
        })}
        <button type="button" className="due-quick-button" onClick={() => choose("")} disabled={!value}>
          <X className="h-3.5 w-3.5" />無日期
        </button>
      </div>
      <label className="relative mt-2 block">
        <span className="sr-only">自選到期日</span>
        <CalendarDays className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
        <input className="field pl-10" type="date" value={value} onChange={(event) => choose(event.target.value)} />
      </label>
      {value ? (
        <p className={`priority-band-hint priority-band-${band ?? "low"}`}>
          系統會按距離每日自動更新：目前為{band === "high" ? "高" : band === "medium" ? "中" : "低"} priority
        </p>
      ) : null}
    </fieldset>
  );
}
