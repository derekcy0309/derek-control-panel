"use client";

import { useEffect, useState } from "react";
import { Copy, Mail, MessageCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  createWrittenReply,
  replyTemplates,
  summarizeWrittenMessage,
  type ReplyTemplateId,
  type WrittenChannel
} from "@/lib/written-communication";

const storageKey = "dcp-suki-written-communication-v1";

type SavedDraft = {
  source: string;
  recipient: string;
  timing: string;
  extra: string;
  templateId: ReplyTemplateId;
  channel: WrittenChannel;
  summary: string;
  subject: string;
  draft: string;
};

const initialDraft: SavedDraft = {
  source: "",
  recipient: "",
  timing: "",
  extra: "",
  templateId: "appointment_confirmation",
  channel: "whatsapp",
  summary: "",
  subject: "",
  draft: ""
};

export function WrittenCommunicationAssistant() {
  const [values, setValues] = useState<SavedDraft>(initialDraft);
  const [hydrated, setHydrated] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedTemplate = replyTemplates.find((template) => template.id === values.templateId) ?? replyTemplates[0];

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) setValues({ ...initialDraft, ...JSON.parse(saved) as Partial<SavedDraft> });
    } catch {
      window.sessionStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(values));
  }, [hydrated, values]);

  function update<K extends keyof SavedDraft>(key: K, value: SavedDraft[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "draft" || key === "templateId" || key === "source") setConfirmed(false);
    setMessage("");
    setError("");
  }

  function generate() {
    const reply = createWrittenReply(values);
    setValues((current) => ({
      ...current,
      summary: summarizeWrittenMessage(current.source),
      subject: reply.subject,
      draft: reply.body
    }));
    setConfirmed(false);
    setMessage("草稿已產生。請先檢查及修改，系統不會自行發送。");
  }

  async function copyDraft() {
    if (!values.draft) return;
    setError("");
    try {
      await navigator.clipboard.writeText(values.draft);
      setMessage("回覆草稿已複製；請在發送前再確認收件人及內容。");
    } catch {
      setError("瀏覽器未能自動複製。請長按或選取草稿後手動複製。");
    }
  }

  function openChannel() {
    if (!confirmed || !values.draft) return;
    const target = values.channel === "email"
      ? `mailto:?subject=${encodeURIComponent(values.subject || selectedTemplate.emailSubject)}&body=${encodeURIComponent(values.draft)}`
      : `https://wa.me/?text=${encodeURIComponent(values.draft)}`;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  function clearDraft() {
    setValues(initialDraft);
    setConfirmed(false);
    setMessage("本頁暫存草稿已清除。");
    setError("");
    window.sessionStorage.removeItem(storageKey);
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <summary className="min-h-11 cursor-pointer list-none font-extrabold text-slate-950">
        書面回覆工具（固定規則，不使用付費 AI）
        <span className="mt-1 block text-sm font-normal text-slate-600">貼入訊息後產生簡短摘要及 WhatsApp／電郵草稿；確認前不會開啟發送程式。</span>
      </summary>
      <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4">
        <label>
          <span className="label">收到的文字訊息（可留空，只使用範本）</span>
          <textarea className="field mt-2 min-h-28" value={values.source} onChange={(event) => update("source", event.target.value)} placeholder="在這裡貼入 WhatsApp 或電郵內容。草稿只暫存在目前分頁。" maxLength={5000} />
        </label>
        <fieldset>
          <legend className="label">選擇常用回覆</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {replyTemplates.map((template) => (
              <button key={template.id} type="button" className={`min-h-14 rounded-xl border px-3 py-2 text-left text-sm font-bold ${values.templateId === template.id ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => update("templateId", template.id)}>{template.label}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="label">稱呼（可留空）</span><input className="field mt-2" value={values.recipient} onChange={(event) => update("recipient", event.target.value)} maxLength={80} placeholder="例如：李太" /></label>
          <label><span className="label">日期／時間（可留空）</span><input className="field mt-2" value={values.timing} onChange={(event) => update("timing", event.target.value)} maxLength={120} placeholder="例如：星期五下午 3 時" /></label>
        </div>
        <label><span className="label">需要補充的內容（可留空）</span><textarea className="field mt-2 min-h-20" value={values.extra} onChange={(event) => update("extra", event.target.value)} maxLength={1000} /></label>
        <fieldset>
          <legend className="label">準備使用</legend>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant={values.channel === "whatsapp" ? "success" : "secondary"} onClick={() => update("channel", "whatsapp")}><MessageCircle className="h-4 w-4" />WhatsApp</Button>
            <Button type="button" variant={values.channel === "email" ? "success" : "secondary"} onClick={() => update("channel", "email")}><Mail className="h-4 w-4" />電郵</Button>
          </div>
        </fieldset>
        <Button type="button" className="min-h-14" onClick={generate}>產生摘要及回覆草稿</Button>
        {values.summary || values.draft ? (
          <section className="grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4" aria-live="polite">
            <div><p className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">規則整理摘要</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{values.summary}</p></div>
            {values.channel === "email" ? <label><span className="label">電郵主旨</span><input className="field mt-2 bg-white" value={values.subject} onChange={(event) => update("subject", event.target.value)} maxLength={160} /></label> : null}
            <label><span className="label">可修改的回覆草稿</span><textarea className="field mt-2 min-h-48 bg-white" value={values.draft} onChange={(event) => update("draft", event.target.value)} maxLength={5000} /></label>
            <label className="flex min-h-12 items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"><input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span className="text-sm font-semibold leading-6 text-slate-800">我已檢查收件人、日期、臨床內容及私隱資料；可以開啟{values.channel === "email" ? "電郵" : "WhatsApp"}。</span></label>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => void copyDraft()}><Copy className="h-4 w-4" />複製草稿</Button><Button type="button" disabled={!confirmed || !values.draft} onClick={openChannel}>{values.channel === "email" ? "開啟電郵" : "開啟 WhatsApp"}</Button></div>
          </section>
        ) : null}
        <Button type="button" variant="ghost" onClick={clearDraft}><RotateCcw className="h-4 w-4" />清除本頁暫存</Button>
        {message ? <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900" role="status">{message}</p> : null}
        {error ? <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
