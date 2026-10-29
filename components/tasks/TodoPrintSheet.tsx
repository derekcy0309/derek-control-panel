import { taskCategoryFor, taskCategoryOptions } from "@/lib/task-categories";
import { taskVisibleNextAction } from "@/lib/task-steps";
import type { Task } from "@/lib/types";

export function TodoPrintSheet({ tasks, name, date }: { tasks: Task[]; name: string; date: string }) {
  return <section className="todo-paper" aria-label="To-do List 紙本預覽">
    <header className="todo-paper-header">
      <div><h2>To-do List</h2><p>{name} · {date}</p></div>
      <span>共 {tasks.length} 項</span>
    </header>
    <p className="todo-paper-instruction">先揀一項開始。每項可填寫「幾點至幾點」，完成後剔選。</p>
    {tasks.map((task, index) => {
      const category = taskCategoryOptions.find(option => option.value === taskCategoryFor(task));
      return <article className="todo-paper-task" key={task.id}>
          <span className="todo-paper-checkbox" aria-label="完成勾選格" />
          <div className="todo-paper-task-content">
            <div className="todo-paper-task-heading"><h4>{index + 1}. {task.title}</h4><span>{category?.label} · 期限：{task.due_date ?? "未設定"}</span></div>
            <p className="todo-paper-next">下一小步：{taskVisibleNextAction(task) ?? "________________________________"}</p>
            <div className="todo-paper-writing"><div className="todo-paper-time"><strong>時段</strong><span>____：____ 至 ____：____</span></div>
            <p className="todo-paper-note">備註：<span /></p></div>
          </div>
        </article>;
    })}
    {!tasks.length ? <p className="todo-paper-empty">尚未選擇工作，請先在上方剔選要列印的任務。</p> : null}
    <footer className="todo-paper-footer">這是列印時的清單，不會自動更新。紙本剔選後，可回 Panel 更新進度。請妥善保管。</footer>
  </section>;
}
