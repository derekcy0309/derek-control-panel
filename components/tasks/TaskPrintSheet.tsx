import type { TaskQueueBuckets } from "@/lib/task-queue";
import type { Task } from "@/lib/types";

export function TaskPrintSheet({ categoryLabel, buckets, printedOn }: { categoryLabel: string; buckets: TaskQueueBuckets; printedOn: string }) {
  const sections: Array<{ title: string; tasks: Task[]; undated?: boolean }> = [
    { title: "已逾期", tasks: buckets.overdue },
    { title: "今日至未來 7 日", tasks: buckets.dueWithin7Days },
    { title: "第 8 至 14 日", tasks: buckets.dueWithin14Days },
    { title: "第 15 日以後", tasks: buckets.dueLater },
    { title: "Urgent（無日期）", tasks: buckets.urgent, undated: true },
    { title: "Semi-urgent（無日期）", tasks: buckets.semiUrgent, undated: true },
    { title: "Non-urgent（無日期）", tasks: buckets.nonUrgent, undated: true },
    { title: "Waiting", tasks: buckets.waiting },
    { title: "Blocked", tasks: buckets.blocked }
  ].filter((section) => section.tasks.length);

  return (
    <section className="task-print-sheet hidden" aria-hidden="true">
      <header className="task-print-header">
        <div>
          <h1>Derek Control Panel｜{categoryLabel}任務</h1>
          <p>未完成行動清單</p>
        </div>
        <p>列印日期：{printedOn}</p>
      </header>
      {sections.length ? sections.map((section) => (
        <section className="task-print-section" key={section.title}>
          <h2>{section.title}（{section.tasks.length}）</h2>
          <table>
            <thead><tr><th className="task-print-check">✓</th><th className="task-print-date">日期</th><th>事項</th><th className="task-print-owner">負責人</th></tr></thead>
            <tbody>
              {section.tasks.map((task) => (
                <tr key={task.id}>
                  <td className="task-print-check">□</td>
                  <td className="task-print-date">{section.undated ? "—" : task.follow_up_date ?? task.due_date ?? "—"}</td>
                  <td>{task.title}</td>
                  <td className="task-print-owner">{task.owner || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )) : <p className="task-print-empty">目前分類沒有未完成任務。</p>}
    </section>
  );
}
