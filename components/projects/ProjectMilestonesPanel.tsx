"use client";

import { useMemo, useState } from "react";
import { Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import type { OperatingItem, ProjectMilestone, Task } from "@/lib/types";

type MilestoneStatus = ProjectMilestone["status"];

const statusLabels: Record<MilestoneStatus, string> = {
  active: "進行中",
  blocked: "等候條件",
  completed: "已完成",
  cancelled: "已取消"
};

export function ProjectMilestonesPanel({
  projects,
  milestones,
  tasks,
  onChanged
}: {
  projects: OperatingItem[];
  milestones: ProjectMilestone[];
  tasks: Task[];
  onChanged: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [critical, setCritical] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const milestonesByProject = useMemo(() => {
    const result = new Map<string, ProjectMilestone[]>();
    for (const milestone of milestones) {
      const current = result.get(milestone.project_id) ?? [];
      current.push(milestone);
      result.set(milestone.project_id, current);
    }
    return result;
  }, [milestones]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await controlAction("save_project_milestone", {
        projectId,
        title: title.trim(),
        deadline: deadline || null,
        critical,
        status: "active"
      });
      setTitle("");
      setDeadline("");
      setCritical(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能新增里程碑，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(milestone: ProjectMilestone, status: MilestoneStatus) {
    setSaving(true);
    setError("");
    try {
      await controlAction("save_project_milestone", { id: milestone.id, title: milestone.title, status });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新里程碑，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(milestone: ProjectMilestone) {
    if (!window.confirm(`刪除「${milestone.title}」？這不會刪除任何任務。`)) return;
    setSaving(true);
    setError("");
    try {
      await controlAction("delete_project_milestone", { id: milestone.id });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能刪除里程碑，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel space-y-5 p-4 sm:p-5" aria-labelledby="project-milestones-title">
      <div>
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-indigo-600" />
          <h2 id="project-milestones-title" className="section-title">項目里程碑與連結任務</h2>
        </div>
        <p className="muted mt-2 text-sm leading-6">里程碑只標示結果與日期。依賴完成後系統只會顯示可繼續的工作，不會自動完成、改派或分享任何任務。</p>
      </div>

      <form className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] sm:items-end" onSubmit={save}>
        <label>
          <span className="label">項目</span>
          <select className="field mt-2 bg-white" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
        <label>
          <span className="label">下一個里程碑</span>
          <input className="field mt-2 bg-white" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：取得已簽署確認" maxLength={240} required />
        </label>
        <label>
          <span className="label">日期（可選）</span>
          <input className="field mt-2 bg-white" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <div className="grid gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)} />關鍵</label>
          <Button type="submit" disabled={saving || !projectId || !title.trim()}><Plus className="h-4 w-4" />新增</Button>
        </div>
      </form>
      {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {projects.map((project) => {
          const projectMilestones = milestonesByProject.get(project.id) ?? [];
          const linkedTasks = tasks.filter((task) => task.project_id === project.id && !["done", "cancelled"].includes(task.status));
          return (
            <article className="rounded-xl border border-slate-200 bg-white p-4" key={project.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-extrabold text-slate-900">{project.title}</h3>
                  <p className="muted mt-1 text-xs">{linkedTasks.length} 項仍在處理的連結任務</p>
                </div>
                {project.due_date ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">項目日期：{formatDate(project.due_date)}</span> : null}
              </div>
              <div className="mt-4 space-y-2">
                {projectMilestones.length ? projectMilestones.map((milestone) => (
                  <div className="rounded-lg bg-slate-50 p-3" key={milestone.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{milestone.critical ? "關鍵 · " : ""}{milestone.title}</p>
                        <p className="muted mt-1 text-xs">{milestone.deadline ? `目標：${formatDate(milestone.deadline)} · ` : ""}{statusLabels[milestone.status]}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold" value={milestone.status} disabled={saving} aria-label={`更新${milestone.title}的狀態`} onChange={(event) => void updateStatus(milestone, event.target.value as MilestoneStatus)}>
                          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <Button type="button" variant="ghost" disabled={saving} title="刪除里程碑" onClick={() => void remove(milestone)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </div>
                )) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">尚未設定里程碑。可以先寫下一個可驗證結果。</p>}
              </div>
              {linkedTasks.length ? <p className="mt-4 rounded-lg bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">連結任務：{linkedTasks.slice(0, 3).map((task) => task.title).join("、")}{linkedTasks.length > 3 ? ` 等 ${linkedTasks.length} 項` : ""}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
