"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/Button";
import { TodoPrintSheet } from "@/components/tasks/TodoPrintSheet";
import { useTodayData } from "@/hooks/useTodayData";
import { hkDateIso } from "@/lib/planning";
import { taskCategoryFor, taskCategoryOptions } from "@/lib/task-categories";
import { customPrintableTasks, printableTaskPool, todayPrintableTasks } from "@/lib/todo-print";
import type { TodayData } from "@/lib/types";

export default function TodoListPage() {
  return <AuthGate><TodoListLoader /></AuthGate>;
}

function TodoListLoader() {
  const { data, loading, error, reload } = useTodayData();
  if (loading) return <LoadingState />;
  if (error || !data) return <section className="panel p-5" role="alert"><h1 className="text-xl font-bold">未能載入 To-do List</h1><p className="mt-3">{error || "請檢查網絡後再試。"}</p><Button className="mt-4" onClick={() => void reload()}>重新嘗試</Button></section>;
  return <TodoListContent key={data.currentUser.id} data={data} />;
}

function TodoListContent({ data }: { data: TodayData }) {
  const today = hkDateIso();
  const [scope, setScope] = useState<"today" | "custom">("today");
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printError, setPrintError] = useState("");
  const pool = useMemo(() => printableTaskPool([...data.taskQueueCatalog, ...data.tasks], data.taskDependencies), [data]);
  const todayTasks = useMemo(() => todayPrintableTasks(pool, data.planning, data.currentUser.id, today), [pool, data.planning, data.currentUser.id, today]);
  const candidates = scope === "today" ? todayTasks : customPrintableTasks(pool, todayTasks);
  const selected = candidates.filter(task => selectedIds === null || selectedIds.has(task.id));
  const visible = candidates.filter(task => (category === "all" || taskCategoryFor(task) === category)
    && task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const displayed = visible.slice(currentPage * 20, currentPage * 20 + 20);

  function changeScope(value: "today" | "custom") {
    setScope(value); setSelectedIds(value === "today" ? null : new Set()); setPage(0); setCategory("all"); setSearch("");
  }
  function toggle(id: string) {
    setSelectedIds(current => {
      const next = new Set(current ?? candidates.map(task => task.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function print() {
    setPrintError("");
    try { window.print(); } catch { setPrintError("這個瀏覽器未能開啟列印。請使用瀏覽器選單的「列印」，或在電腦開啟此頁。 "); }
  }

  return <div className="todo-print-root mx-auto max-w-4xl space-y-5">
    <section className="no-print panel p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div><h1 className="page-title">列印 To-do List</h1><p className="muted mt-2 text-sm">直接使用現有任務；只製作紙本，不會新增、完成或更改任務。</p></div>
        <Button onClick={print} disabled={!selected.length}><Printer className="h-5 w-5" />列印／儲存 PDF（{selected.length}）</Button>
      </div>
      <p className="muted mt-3 text-sm">A4 直向 · 勾選格 · 手寫時段及備註。可在列印視窗選擇「儲存為 PDF」。</p>
      {printError ? <p className="mt-3 text-sm text-amber-800" role="alert">{printError}</p> : null}
      <fieldset className="mt-5"><legend className="label">選擇列印內容</legend><div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant={scope === "today" ? "primary" : "secondary"} aria-pressed={scope === "today"} onClick={() => changeScope("today")}>今日已安排</Button>
        <Button variant={scope === "custom" ? "primary" : "secondary"} aria-pressed={scope === "custom"} onClick={() => changeScope("custom")}>自行揀選任務</Button>
      </div></fieldset>
      <p className="muted mt-3 text-sm">已完成、等待中、受阻及封存項目不列入待辦清單。今日清單沿用你已確認的安排。</p>
      {candidates.length ? <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label><span className="label">分類</span><select aria-label="分類" className="field mt-1" value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="all">全部分類（跟隨已安排次序）</option>{taskCategoryOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span className="label">搜尋任務</span><input className="field mt-1" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="輸入任務名稱" /></label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3"><p className="text-sm font-semibold" role="status">已選 {selected.length} 項（包括其他分類及頁面）</p><Button variant="ghost" onClick={() => setSelectedIds(new Set())}>清除選取</Button></div>
        <div className="mt-2 space-y-2" aria-label="揀選列印任務">{displayed.map(task => <label key={task.id} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" type="checkbox" checked={selectedIds === null || selectedIds.has(task.id)} onChange={() => toggle(task.id)} /><span className="min-w-0 break-words"><span className="block font-semibold">{task.title}</span><span className="muted text-xs">{taskCategoryOptions.find(item => item.value === taskCategoryFor(task))?.label} · 期限：{task.due_date ?? "未設定"}</span></span></label>)}</div>
        {!displayed.length ? <p className="muted mt-3">沒有符合篩選的任務；可清除搜尋或更改分類。</p> : null}
        {pages > 1 ? <nav className="mt-3 flex items-center justify-between gap-2" aria-label="列印任務分頁"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一頁</Button><span className="text-sm">{currentPage + 1}／{pages}</span><Button variant="secondary" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>下一頁</Button></nav> : null}
      </> : <div className="mt-4 rounded-xl bg-slate-50 p-4"><p>{scope === "today" ? "今日未有已安排的待辦工作。可按「自行揀選任務」製作清單，或先在行動中心安排今日工作。" : "目前沒有可列印的待辦工作。"}</p><Link className="mt-2 inline-flex min-h-11 items-center font-semibold text-indigo-700" href="/">返回行動中心</Link></div>}
    </section>
    <TodoPrintSheet tasks={selected} name={data.currentUser.displayName} date={today} />
  </div>;
}
