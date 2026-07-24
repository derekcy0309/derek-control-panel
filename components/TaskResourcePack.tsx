"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, ExternalLink, FileText, Link2, LockKeyhole, Mail, PackageOpen, Phone, Plus, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction, loadTaskResources } from "@/lib/control-api";
import type { OperatingItem, TaskResource, TaskResourceType } from "@/lib/types";

type LinkedOption = Pick<OperatingItem, "id" | "title" | "item_type">;

const resourceTypeOptions: Array<{ value: TaskResourceType; label: string }> = [
  { value: "url", label: "網址" },
  { value: "document", label: "文件" },
  { value: "storage_file", label: "Supabase Storage 檔案" },
  { value: "contact", label: "聯絡人" },
  { value: "note", label: "Notes" },
  { value: "sop", label: "SOP" },
  { value: "decision", label: "Decision" },
  { value: "project", label: "Project" },
  { value: "waiting", label: "Waiting" }
];

const linkedResourceTypes = new Set<TaskResourceType>(["document", "note", "sop", "decision", "project", "waiting"]);
const workspaceViewForType: Partial<Record<TaskResourceType, string>> = {
  document: "document",
  note: "note",
  sop: "sop",
  decision: "decision",
  project: "project",
  waiting: "waiting"
};

type FormState = {
  resourceType: TaskResourceType;
  label: string;
  url: string;
  storageBucket: string;
  storagePath: string;
  linkedItemId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  shareWithTask: boolean;
};

const emptyForm = (): FormState => ({
  resourceType: "url",
  label: "",
  url: "",
  storageBucket: "",
  storagePath: "",
  linkedItemId: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  shareWithTask: false
});

export function TaskResourcePack({
  taskId,
  currentUserId,
  availableItems = [],
  editable = false,
  focus = false
}: {
  taskId: string;
  currentUserId?: string;
  availableItems?: LinkedOption[];
  editable?: boolean;
  focus?: boolean;
}) {
  const [resources, setResources] = useState<TaskResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadTaskResources(taskId);
      setResources(result.resources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取資源包。請重試。");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const linkedOptions = useMemo(() => {
    const itemType = form.resourceType === "document" ? "document" : form.resourceType;
    return availableItems.filter((item) => item.item_type === itemType);
  }, [availableItems, form.resourceType]);
  const needsLinkedItem = linkedResourceTypes.has(form.resourceType) && !(form.resourceType === "document" && form.url.trim());

  async function createResource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("new");
    setError("");
    try {
      await controlAction("create_task_resource", { taskId, ...form });
      setForm(emptyForm());
      setAdding(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能加入資源。請重試。");
    } finally {
      setBusyId(null);
    }
  }

  async function setSharing(resource: TaskResource, shareWithTask: boolean) {
    setBusyId(resource.id);
    setError("");
    try {
      await controlAction("set_task_resource_sharing", { id: resource.id, shareWithTask });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新分享設定。請重試。");
    } finally {
      setBusyId(null);
    }
  }

  async function removeResource(resource: TaskResource) {
    if (!window.confirm(`移除「${resource.label}」？這不會刪除原本的文件或項目。`)) return;
    setBusyId(resource.id);
    setError("");
    try {
      await controlAction("delete_task_resource", { id: resource.id });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能移除資源。請重試。");
    } finally {
      setBusyId(null);
    }
  }

  async function openStorageResource(resource: TaskResource) {
    setBusyId(resource.id);
    setError("");
    try {
      const result = await controlAction<{ url: string }>("open_task_storage_resource", { id: resource.id });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能開啟 Storage 檔案。請重試。");
    } finally {
      setBusyId(null);
    }
  }

  const surfaceClass = focus
    ? "mt-6 rounded-2xl border border-white/10 bg-white/[.06] p-5 text-white"
    : "mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3";
  const mutedClass = focus ? "text-white/65" : "text-slate-600";

  return (
    <section className={surfaceClass} aria-label="任務資源包">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageOpen className={`h-4 w-4 ${focus ? "text-indigo-300" : "text-indigo-600"}`} />
            <h3 className="text-sm font-extrabold">任務資源包</h3>
          </div>
          <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>只顯示你可開啟的文件、連結與聯絡資料；任務分享不會自動分享私人資源。</p>
        </div>
        {editable ? (
          <Button type="button" variant="secondary" onClick={() => setAdding((value) => !value)} disabled={busyId !== null}>
            <Plus className="h-4 w-4" />{adding ? "收起" : "加入資源"}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-white p-3 text-slate-900" onSubmit={(event) => void createResource(event)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">資源類型</span><select className="field mt-1" value={form.resourceType} onChange={(event) => setForm((current) => ({ ...current, resourceType: event.target.value as TaskResourceType, linkedItemId: "", url: "" }))}>{resourceTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label><span className="label">顯示名稱</span><input className="field mt-1" value={form.label} maxLength={200} required onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="例如：報價表、致電陳小姐" /></label>
          </div>
          {form.resourceType === "url" || (form.resourceType === "document" && !form.linkedItemId) ? (
            <label><span className="label">HTTPS 網址</span><input className="field mt-1" type="url" value={form.url} required={form.resourceType === "url" || !form.linkedItemId} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value, linkedItemId: "" }))} placeholder="https://…" /></label>
          ) : null}
          {form.resourceType === "storage_file" ? (
            <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Storage bucket</span><input className="field mt-1" value={form.storageBucket} required onChange={(event) => setForm((current) => ({ ...current, storageBucket: event.target.value }))} placeholder="private-files" /></label><label><span className="label">Object path</span><input className="field mt-1" value={form.storagePath} required onChange={(event) => setForm((current) => ({ ...current, storagePath: event.target.value }))} placeholder="derek/file.pdf" /></label></div>
          ) : null}
          {form.resourceType === "contact" ? (
            <div className="grid gap-3 sm:grid-cols-3"><label><span className="label">姓名</span><input className="field mt-1" value={form.contactName} required onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} /></label><label><span className="label">電話</span><input className="field mt-1" type="tel" value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} /></label><label><span className="label">電郵</span><input className="field mt-1" type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} /></label></div>
          ) : null}
          {needsLinkedItem ? (
            <label><span className="label">現有{resourceTypeOptions.find((option) => option.value === form.resourceType)?.label}</span><select className="field mt-1" value={form.linkedItemId} required onChange={(event) => { const selected = linkedOptions.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, linkedItemId: event.target.value, label: current.label || selected?.title || "" })); }}><option value="">選擇一項…</option>{linkedOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{linkedOptions.length === 0 ? <span className="mt-1 block text-xs text-slate-500">目前沒有你可連結的同類項目；可先到相應模組建立。</span> : null}</label>
          ) : null}
          {form.resourceType === "document" && form.url ? <p className="text-xs text-slate-500">如想改為系統內文件，先清除網址後再選擇已有文件。</p> : null}
          <label className="flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-sm font-semibold text-slate-800"><input className="mt-0.5 h-5 w-5" type="checkbox" checked={form.shareWithTask} onChange={(event) => setForm((current) => ({ ...current, shareWithTask: event.target.checked }))} /><span><span className="flex items-center gap-1"><Share2 className="h-4 w-4" />明確分享給可查看此任務的人</span><span className="mt-1 block text-xs font-normal text-slate-600">預設只你可見。系統內 Notes／SOP 等仍會再檢查對方本身是否有權閱讀。</span></span></label>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busyId === "new"}>{busyId === "new" ? "儲存中…" : "加入資源"}</Button><Button type="button" variant="secondary" onClick={() => { setAdding(false); setForm(emptyForm()); }} disabled={busyId === "new"}>取消</Button></div>
        </form>
      ) : null}

      {loading ? <p className={`mt-3 text-sm ${mutedClass}`}>正在載入可用資源…</p> : null}
      {!loading && resources.length === 0 ? <p className={`mt-3 text-sm ${mutedClass}`}>{editable ? "暫未加入資源。需要時可加一個最常用的連結或聯絡方法。" : "這項任務暫未有你可開啟的資源。"}</p> : null}
      {!loading && resources.length ? <div className="mt-3 grid gap-2">{resources.map((resource) => <ResourceRow key={resource.id} resource={resource} focus={focus} busy={busyId === resource.id} editable={editable && resource.owner_id === currentUserId} onOpenStorage={openStorageResource} onShare={setSharing} onDelete={removeResource} />)}</div> : null}
      {error ? <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${focus ? "bg-amber-400/15 text-amber-100" : "bg-amber-50 text-amber-900"}`} role="alert">{error}</p> : null}
    </section>
  );
}

function ResourceRow({ resource, focus, busy, editable, onOpenStorage, onShare, onDelete }: { resource: TaskResource; focus: boolean; busy: boolean; editable: boolean; onOpenStorage: (resource: TaskResource) => Promise<void>; onShare: (resource: TaskResource, value: boolean) => Promise<void>; onDelete: (resource: TaskResource) => Promise<void> }) {
  const linkView = workspaceViewForType[resource.resource_type];
  const rowClass = focus ? "border-white/10 bg-black/15" : "border-slate-200 bg-white";
  const textClass = focus ? "text-white/70" : "text-slate-600";
  return <div className={`rounded-xl border p-3 ${rowClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ResourceIcon type={resource.resource_type} /><p className="font-bold">{resource.label}</p>{resource.share_with_task ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">已明確分享</span> : <span className={`flex items-center gap-1 text-xs font-semibold ${textClass}`}><LockKeyhole className="h-3.5 w-3.5" />私人</span>}</div><p className={`mt-1 text-xs ${textClass}`}>{resourceTypeOptions.find((option) => option.value === resource.resource_type)?.label}</p></div>
      <div className="flex flex-wrap gap-2"><ResourceOpenAction resource={resource} linkView={linkView} busy={busy} onOpenStorage={onOpenStorage} />{editable ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void onDelete(resource)}><Trash2 className="h-4 w-4" />移除</Button> : null}</div>
    </div>
    {resource.resource_type === "contact" ? <div className="mt-2 flex flex-wrap gap-3 text-sm">{resource.contact_phone ? <a className="inline-flex items-center gap-1 font-semibold text-indigo-700 underline" href={`tel:${resource.contact_phone}`}><Phone className="h-4 w-4" />{resource.contact_phone}</a> : null}{resource.contact_email ? <a className="inline-flex items-center gap-1 font-semibold text-indigo-700 underline" href={`mailto:${resource.contact_email}`}><Mail className="h-4 w-4" />{resource.contact_email}</a> : null}</div> : null}
    {editable ? <label className={`mt-3 flex items-center gap-2 text-xs font-semibold ${textClass}`}><input type="checkbox" className="h-4 w-4" checked={resource.share_with_task} disabled={busy} onChange={(event) => void onShare(resource, event.target.checked)} />明確分享給任務參與者</label> : null}
  </div>;
}

function ResourceOpenAction({ resource, linkView, busy, onOpenStorage }: { resource: TaskResource; linkView?: string; busy: boolean; onOpenStorage: (resource: TaskResource) => Promise<void> }) {
  if ((resource.resource_type === "url" || (resource.resource_type === "document" && resource.url)) && resource.url) return <a className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />開啟</a>;
  if (resource.resource_type === "storage_file") return <Button type="button" variant="secondary" disabled={busy} onClick={() => void onOpenStorage(resource)}><Database className="h-4 w-4" />{busy ? "開啟中…" : "開啟檔案"}</Button>;
  if (linkView) return <a className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50" href={`/workspace/${linkView}`}><ExternalLink className="h-4 w-4" />查看</a>;
  return null;
}

function ResourceIcon({ type }: { type: TaskResourceType }) {
  const className = "h-4 w-4 text-indigo-600";
  if (type === "contact") return <Phone className={className} />;
  if (type === "storage_file") return <Database className={className} />;
  if (type === "url") return <Link2 className={className} />;
  return <FileText className={className} />;
}
