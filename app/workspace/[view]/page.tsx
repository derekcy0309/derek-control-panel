"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Archive, CalendarClock, Check, FileLock2, Filter, Plus, Search, Share2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatCurrency, formatDate } from "@/lib/date";
import { waitingAge, weightedPipelineRevenue } from "@/lib/planning";
import type { Area, OperatingItem } from "@/lib/types";
import { useControlData } from "@/hooks/useControlData";

const views: Record<string, ViewConfig> = {
  inbox: { title: "快速收集箱", eyebrow: "Quick Capture", description: "先記下內容，稍後再分類。首次只需要輸入一句。", area: "personal", itemType: "inbox", addLabel: "快速記下" },
  project: { title: "項目作戰室", eyebrow: "Work", description: "集中看下一個里程碑、阻礙、關鍵路徑及停滯工作。", area: "work", itemType: "project", addLabel: "新增項目" },
  waiting: { title: "等待中", eyebrow: "Waiting For", description: "把等待回覆變成有日期、有下一次跟進的閉環。", area: "work", itemType: "waiting", addLabel: "新增等待事項" },
  decision: { title: "決策紀錄", eyebrow: "Decision Log", description: "保留問題、選項、期限與最後理據，減少決策債。", area: "work", itemType: "decision", addLabel: "新增決策" },
  client: { title: "客戶流程", eyebrow: "Private Care Business", description: "查看轉介、下一次跟進、加權收入及個案狀態。臨床資料預設高度敏感。", area: "work", itemType: "client", addLabel: "新增潛在個案", sensitive: true },
  sop: { title: "SOP 範本", eyebrow: "Operations", description: "用清單、相對日期及證據要求把服務流程標準化。", area: "work", itemType: "sop", addLabel: "新增 SOP" },
  family: { title: "家庭總覽", eyebrow: "Family OS", description: "家庭只是分類入口，不代表自動分享。所有項目仍然預設私人。", area: "family", addLabel: "新增家庭事項" },
  school: { title: "子女及學校", eyebrow: "Family", description: "整理通告、簽署、繳費、活動及所需物品。敏感內容預設私人。", area: "family", itemType: "school", addLabel: "新增學校事項", sensitive: true },
  pet: { title: "寵物照護", eyebrow: "Family", description: "管理疫苗、防蟲、覆診、藥物、補給及週期照護。", area: "family", itemType: "pet", addLabel: "新增寵物事項" },
  household: { title: "家居管理", eyebrow: "Family", description: "跟進維修、保養、家電、保養期及供應商。", area: "family", itemType: "household", addLabel: "新增家居事項" },
  shopping: { title: "家庭購物", eyebrow: "Family", description: "按商店、分類及負責人整理採購，完成後保留紀錄。", area: "family", itemType: "shopping", addLabel: "加入購物項目" },
  personal: { title: "個人總覽", eyebrow: "Personal OS", description: "只顯示你自己的行政、健康、文件、車輛、筆記及目標。", area: "personal", addLabel: "新增個人事項" },
  health: { title: "健康行政", eyebrow: "Personal", description: "只作預約、文件及跟進管理，不作診斷或治療建議。預設私人。", area: "personal", itemType: "health", addLabel: "新增健康行政", sensitive: true },
  document: { title: "文件", eyebrow: "Personal", description: "追蹤發出日、到期日及遮罩編號；檔案分享需要另行確認。", area: "personal", itemType: "document", addLabel: "新增文件", sensitive: true },
  vehicle: { title: "車輛", eyebrow: "Personal", description: "管理牌照、保險、驗車、保養、維修及費用。", area: "personal", itemType: "vehicle", addLabel: "新增車輛事項" },
  note: { title: "私人筆記", eyebrow: "Personal", description: "筆記不會出現在對方搜尋、共享預覽或通知內容。", area: "personal", itemType: "note", addLabel: "新增私人筆記", sensitive: true }
};

export default function WorkspacePage() { return <AuthGate><WorkspaceContent /></AuthGate>; }

function WorkspaceContent() {
  const params = useParams<{ view: string }>();
  const config = views[params.view] ?? views.inbox;
  const { data, loading, error, reload } = useControlData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<OperatingItem | null>(null);
  const [adding, setAdding] = useState(false);

  const items = useMemo(() => {
    if (!data) return [];
    return data.operatingItems.filter((item) => {
      if (item.area !== config.area) return false;
      if (config.itemType && item.item_type !== config.itemType) return false;
      if (status === "active" && ["completed","cancelled"].includes(item.status)) return false;
      if (status !== "all" && status !== "active" && item.status !== status) return false;
      if (query && !`${item.title} ${item.description || ""} ${item.next_action || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [config, data, query, status]);

  if (loading || error || !data) return <LoadingState error={error} />;
  const weightedRevenue = config.itemType === "client" ? weightedPipelineRevenue(items.map((item) => ({ monthlyRevenue: Number(item.metadata.monthlyRevenue || 0), conversionProbability: Number(item.metadata.conversionProbability || 0) / 100 }))) : 0;

  async function update(item: OperatingItem, changes: Record<string, unknown>) { await controlAction("update_item", { id: item.id, changes }); await reload(); }

  return <div className="space-y-5">
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">{config.eyebrow}</p><h1 className="page-title mt-1">{config.title}</h1><p className="muted mt-2 max-w-3xl text-sm leading-6">{config.description}</p></div><Button onClick={() => setAdding(true)}><Plus className="h-5 w-5" />{config.addLabel}</Button></section>
    {config.itemType === "client" ? <section className="grid gap-3 sm:grid-cols-3"><Metric label="加權每月收入" value={formatCurrency(weightedRevenue)} /><Metric label="流程內個案" value={String(items.length)} /><Metric label="臨床資料" value="高度敏感" /></section> : null}
    <section className="panel flex flex-col gap-3 p-3 sm:flex-row"><label className="relative flex-1"><span className="sr-only">搜尋此頁</span><Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋標題、內容或下一步" /></label><label className="relative sm:w-48"><span className="sr-only">狀態</span><Filter className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><select className="field pl-10" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">進行中</option><option value="waiting">等待中</option><option value="blocked">受阻</option><option value="review">待檢視</option><option value="completed">已完成</option><option value="all">全部</option></select></label></section>
    <section className="grid gap-3 xl:grid-cols-2">{items.length ? items.map((item) => <ItemCard key={item.id} item={item} currentUserId={data.currentUser.id} onEdit={() => setEditing(item)} onComplete={() => update(item, { status: "completed" })} onArchive={() => update(item, { archived_at: new Date().toISOString() })} />) : <div className="panel col-span-full p-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Plus className="h-5 w-5" /></div><h2 className="mt-4 text-lg font-bold">目前沒有{config.title}項目</h2><p className="muted mt-2 text-sm">你可以新增第一項，或調整上方篩選。</p><Button className="mt-5" onClick={() => setAdding(true)}>{config.addLabel}</Button></div>}</section>
    {adding || editing ? <ItemModal config={config} item={editing} currentUserId={data.currentUser.id} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); void reload(); }} /> : null}
  </div>;
}

function ItemCard({ item, currentUserId, onEdit, onComplete, onArchive }: { item: OperatingItem; currentUserId: string; onEdit: () => void; onComplete: () => void; onArchive: () => void }) {
  const owner = item.owner_id === currentUserId;
  const age = item.item_type === "waiting" && typeof item.metadata.lastContactDate === "string" ? waitingAge(item.metadata.lastContactDate) : null;
  return <article className="panel p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{itemTypeLabel[item.item_type] || item.item_type}</span>{item.sensitive ? <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"><FileLock2 className="h-3.5 w-3.5" />敏感</span> : null}{item.visibility !== "private" ? <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700"><Share2 className="h-3.5 w-3.5" />{item.visibility === "assigned" ? "已指派" : item.visibility === "joint" ? "共同項目" : "已分享"}</span> : null}</div><h2 className="mt-3 break-words text-lg font-bold">{item.title}</h2></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${item.status === "blocked" ? "bg-red-50 text-red-700" : item.status === "waiting" ? "bg-amber-50 text-amber-700" : item.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel[item.status]}</span></div>{item.description ? <p className="muted mt-3 line-clamp-3 text-sm leading-6">{item.description}</p> : null}<div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{item.next_action ? <p><span className="font-semibold">下一步：</span>{item.next_action}</p> : null}{item.due_date ? <p className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-slate-400" />{formatDate(item.due_date)}</p> : null}{age ? <p className="text-amber-700">已等待 {age.days} 日 · {age.band}</p> : null}{item.item_type === "client" && item.metadata.monthlyRevenue ? <p>每月收入：{formatCurrency(Number(item.metadata.monthlyRevenue))}</p> : null}</div>{owner ? <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={onEdit}>修改</Button>{item.status !== "completed" ? <Button variant="success" onClick={onComplete}><Check className="h-4 w-4" />完成</Button> : null}<Button variant="ghost" onClick={onArchive}><Archive className="h-4 w-4" />封存</Button></div> : <p className="muted mt-4 text-xs">由對方分享 · 只按授權權限顯示</p>}</article>;
}

function ItemModal({ config, item, onClose, onSaved }: { config: ViewConfig; item: OperatingItem | null; currentUserId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: item?.title ?? "", description: item?.description ?? "", dueDate: item?.due_date ?? "", nextAction: item?.next_action ?? "", status: item?.status ?? (config.itemType === "inbox" ? "inbox" : "active"), sensitive: item?.sensitive ?? Boolean(config.sensitive), monthlyRevenue: String(item?.metadata.monthlyRevenue ?? ""), conversionProbability: String(item?.metadata.conversionProbability ?? ""), person: String(item?.metadata.person ?? ""), lastContactDate: String(item?.metadata.lastContactDate ?? ""), store: String(item?.metadata.store ?? "") });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  function set(name: keyof typeof form, value: string | boolean) { setForm((current) => ({ ...current, [name]: value })); }
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); const metadata: Record<string, unknown> = { ...(item?.metadata ?? {}) }; if (config.itemType === "client") { metadata.monthlyRevenue = Number(form.monthlyRevenue || 0); metadata.conversionProbability = Number(form.conversionProbability || 0); } if (config.itemType === "waiting") { metadata.person = form.person; metadata.lastContactDate = form.lastContactDate; } if (config.itemType === "shopping") metadata.store = form.store; try { if (item) await controlAction("update_item", { id: item.id, changes: { title: form.title, description: form.description || null, due_date: form.dueDate || null, next_action: form.nextAction || null, status: form.status, metadata } }); else await controlAction("create_item", { itemType: config.itemType || (config.area === "family" ? "event" : "note"), title: form.title, description: form.description, dueDate: form.dueDate, nextAction: form.nextAction, status: form.status, area: config.area, sensitive: form.sensitive, metadata }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "未能儲存。"); } finally { setSaving(false); } }
  return <Modal title={item ? `修改${config.title}項目` : config.addLabel} onClose={onClose}><form className="grid gap-4" onSubmit={save}><label><span className="label">名稱</span><input className="field mt-2" value={form.title} onChange={(event) => set("title", event.target.value)} autoFocus required /></label>{config.itemType !== "inbox" ? <><label><span className="label">內容</span><textarea className="field mt-2 min-h-28" value={form.description} onChange={(event) => set("description", event.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="label">日期／死線</span><input className="field mt-2" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} /></label><label><span className="label">狀態</span><select className="field mt-2" value={form.status} onChange={(event) => set("status", event.target.value as typeof form.status)}><option value="active">進行中</option><option value="waiting">等待中</option><option value="blocked">受阻</option><option value="review">待檢視</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label></div><label><span className="label">清晰下一步</span><input className="field mt-2" value={form.nextAction} onChange={(event) => set("nextAction", event.target.value)} placeholder="例如：打開表格，列出尚欠資料" /></label></> : null}{config.itemType === "waiting" ? <div className="grid gap-4 sm:grid-cols-2"><label><span className="label">等待誰</span><input className="field mt-2" value={form.person} onChange={(event) => set("person", event.target.value)} /></label><label><span className="label">上次聯絡</span><input className="field mt-2" type="date" value={form.lastContactDate} onChange={(event) => set("lastContactDate", event.target.value)} /></label></div> : null}{config.itemType === "client" ? <div className="grid gap-4 sm:grid-cols-2"><label><span className="label">預計每月收入（HKD）</span><input className="field mt-2" type="number" min="0" value={form.monthlyRevenue} onChange={(event) => set("monthlyRevenue", event.target.value)} /></label><label><span className="label">成交機會（%）</span><input className="field mt-2" type="number" min="0" max="100" value={form.conversionProbability} onChange={(event) => set("conversionProbability", event.target.value)} /></label></div> : null}{config.itemType === "shopping" ? <label><span className="label">商店</span><input className="field mt-2" value={form.store} onChange={(event) => set("store", event.target.value)} /></label> : null}<label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={form.sensitive} onChange={(event) => set("sensitive", event.target.checked)} /><span><span className="block font-semibold">敏感資料</span><span className="muted block text-xs">附件及 linked document 不會預設分享</span></span></label>{error ? <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button><Button type="button" variant="secondary" onClick={onClose}>取消</Button></div></form></Modal>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="panel p-4"><p className="muted text-xs font-bold uppercase tracking-[.1em]">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></div>; }
type ViewConfig = { title: string; eyebrow: string; description: string; area: Area; itemType?: string; addLabel: string; sensitive?: boolean };
const statusLabel: Record<OperatingItem["status"], string> = { inbox: "收集箱", active: "進行中", waiting: "等待中", blocked: "受阻", review: "待檢視", completed: "已完成", cancelled: "已取消" };
const itemTypeLabel: Record<string, string> = { inbox: "收集箱", project: "項目", waiting: "等待", decision: "決策", client: "客戶", sop: "SOP", school: "學校", event: "家庭事項", pet: "寵物", household: "家居", shopping: "購物", health: "健康行政", document: "文件", vehicle: "車輛", note: "私人筆記" };
