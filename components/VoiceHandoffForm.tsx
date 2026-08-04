"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Save, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { isLikelyDuplicate, parseHandoffText, type HandoffPreview } from "@/lib/handoff-parser";
import { taskTypeLabels } from "@/lib/workspace-role";
import type { Task, WorkflowTaskType } from "@/lib/types";

const taskTypes = Object.keys(taskTypeLabels) as WorkflowTaskType[];

export function VoiceHandoffForm({
  currentUserId,
  currentUserName,
  participants,
  tasks,
  onSaved,
  onCancel
}: {
  currentUserId: string;
  currentUserName: string;
  participants: Array<{ user_id: string; display_name: string }>;
  tasks: Task[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [clientRequestId, setClientRequestId] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const recognitionRef = useRef<any>(null);
  const draftKey = `dcp:voice-handoff-draft:v1:${currentUserId}`;
  const people = useMemo(() => {
    const byId = new Map(participants.map((person) => [person.user_id, person]));
    byId.set(currentUserId, { user_id: currentUserId, display_name: currentUserName });
    return [...byId.values()];
  }, [currentUserId, currentUserName, participants]);
  const duplicate = preview ? isLikelyDuplicate(preview, tasks) : false;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { text?: string; preview?: HandoffPreview; clientRequestId?: string };
        setText(typeof parsed.text === "string" ? parsed.text : "");
        setPreview(parsed.preview?.title ? parsed.preview : null);
        setClientRequestId(parsed.clientRequestId || crypto.randomUUID());
        setMessage("已恢復上次未送出的交接草稿。");
      } else {
        setClientRequestId(crypto.randomUUID());
      }
    } catch {
      setClientRequestId(crypto.randomUUID());
    }
    return () => recognitionRef.current?.abort?.();
  }, [draftKey]);

  useEffect(() => {
    if (!clientRequestId) return;
    try {
      if (!text.trim() && !preview) {
        sessionStorage.removeItem(draftKey);
        return;
      }
      sessionStorage.setItem(draftKey, JSON.stringify({ text, preview, clientRequestId }));
    } catch {
      // A blocked or full session store must never stop the handoff form itself.
    }
  }, [clientRequestId, draftKey, preview, text]);

  function startVoice() {
    setMessage("");
    const voiceWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const Recognition = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("此裝置未支援語音轉文字；可直接輸入，所有功能仍可使用。");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-HK";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event: any) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalText += event.results[index][0]?.transcript ?? "";
      }
      if (finalText.trim()) setText((current) => [current.trim(), finalText.trim()].filter(Boolean).join(" "));
    };
    recognition.onerror = () => setMessage("語音轉文字暫時未能使用；文字草稿仍然保留，可直接輸入或重試。");
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopVoice() {
    recognitionRef.current?.stop?.();
    setListening(false);
  }

  function makePreview() {
    if (!text.trim()) {
      setMessage("先講或輸入一句交接內容就可以了。");
      return;
    }
    setPreview(parseHandoffText({
      text,
      participants: people,
      currentUserId,
      currentUserName
    }));
    setAllowDuplicate(false);
    setMessage("已整理成預覽；請確認內容，尚未建立任務。");
  }

  function change<K extends keyof HandoffPreview>(key: K, value: HandoffPreview[K]) {
    setPreview((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!preview || saving) return;
    if (!preview.title.trim() || !preview.nextAction.trim()) {
      setMessage("請補回任務名稱及下一步，才可以安全建立。");
      return;
    }
    if (duplicate && !allowDuplicate) {
      setMessage("系統找到可能重複的任務；請先確認是否仍要建立。");
      return;
    }
    setSaving(true);
    setMessage("");
    const handoffTarget = preview.ownerId && preview.ownerId !== currentUserId ? preview.ownerId : null;
    const decisionRecipient = preview.needsDecisionFromId
      && preview.needsDecisionFromId !== currentUserId
      && preview.needsDecisionFromId !== handoffTarget
      ? preview.needsDecisionFromId
      : null;
    try {
      await controlAction("create_task", {
        clientRequestId: clientRequestId || crypto.randomUUID(),
        area: "work",
        sourceType: "follow_up",
        title: preview.title.trim(),
        description: preview.originalText,
        nextAction: preview.nextAction.trim(),
        dueDate: preview.dueDate || null,
        status: "not_started",
        risk: preview.risk,
        requestedPriority: preview.risk === "high" ? 1 : preview.risk === "medium" ? 2 : 3,
        caseCode: preview.caseCode || null,
        taskType: preview.taskType,
        materialsRequired: preview.materialsRequired || null,
        rnRequired: preview.rnRequired,
        clientUpdateRequired: preview.clientUpdateRequired,
        needsDecisionFromId: preview.needsDecisionFromId || null,
        handoffToUserId: handoffTarget,
        handoffNote: handoffTarget ? preview.nextAction.trim() : null,
        noticeUserIds: decisionRecipient ? [decisionRecipient] : []
      });
      sessionStorage.removeItem(draftKey);
      setText("");
      setPreview(null);
      setClientRequestId(crypto.randomUUID());
      onSaved();
    } catch (caught) {
      setMessage(caught instanceof Error
        ? `尚未儲存：${caught.message} 草稿仍然保留，可修正後重試。`
        : "尚未儲存。草稿仍然保留，可稍後重試。");
    } finally {
      setSaving(false);
    }
  }

  if (!preview) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
          <p className="font-extrabold">可以照平時講廣東話</p>
          <p className="mt-1">個案是誰？要做甚麼？幾時完成？由誰負責？有甚麼需要確認？</p>
        </div>
        <label className="block">
          <span className="label">交接內容</span>
          <textarea
            className="field mt-2 min-h-44 text-base"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="例如：李太星期五出院，Suki問醫院攞 antibiotic schedule，安排星期五晚 RN，準備 PICC dressing pack，抗生素時間要我確認。"
            autoFocus
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button type="button" variant={listening ? "danger" : "secondary"} onClick={listening ? stopVoice : startVoice}>
            {listening ? <><MicOff className="h-5 w-5" />停止聽寫</> : <><Mic className="h-5 w-5" />開始語音聽寫</>}
          </Button>
          <Button type="button" onClick={makePreview} disabled={!text.trim()}>
            <Sparkles className="h-5 w-5" />整理成預覽
          </Button>
        </div>
        <p className="text-xs leading-5 text-slate-500">使用裝置原生語音聽寫，不會保存原始錄音，也沒有新增付費 AI 服務。</p>
        {message ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">{message}</p> : null}
        <Button type="button" variant="ghost" onClick={onCancel}>返回</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
        <p className="flex items-center gap-2 font-extrabold"><ShieldCheck className="h-5 w-5" />儲存前確認</p>
        <p className="mt-1">以下只是工作草稿，不會自動作出臨床決定。需要確認的內容必須由指定人員按確認。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label">任務名稱</span><input className="field mt-2" value={preview.title} onChange={(event) => change("title", event.target.value)} /></label>
        <label className="sm:col-span-2"><span className="label">下一步</span><textarea className="field mt-2 min-h-24" value={preview.nextAction} onChange={(event) => change("nextAction", event.target.value)} /></label>
        <label><span className="label">個案／病人代號</span><input className="field mt-2" value={preview.caseCode} onChange={(event) => change("caseCode", event.target.value)} placeholder="避免完整姓名" /></label>
        <label><span className="label">截止日期（可留空）</span><input className="field mt-2" type="date" value={preview.dueDate} onChange={(event) => change("dueDate", event.target.value)} /></label>
        <label><span className="label">由誰跟進</span><select className="field mt-2" value={preview.ownerId} onChange={(event) => { const person = people.find((item) => item.user_id === event.target.value); change("ownerId", event.target.value); change("ownerName", person?.display_name ?? ""); }}>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.user_id === currentUserId ? `我（${person.display_name}）` : person.display_name}</option>)}</select></label>
        <label><span className="label">工作類別</span><select className="field mt-2" value={preview.taskType} onChange={(event) => change("taskType", event.target.value as WorkflowTaskType)}>{taskTypes.map((type) => <option key={type} value={type}>{taskTypeLabels[type]}</option>)}</select></label>
        <label><span className="label">需要誰決定／確認</span><select className="field mt-2" value={preview.needsDecisionFromId} onChange={(event) => { const person = people.find((item) => item.user_id === event.target.value); change("needsDecisionFromId", event.target.value); change("needsDecisionFromName", person?.display_name ?? ""); }}><option value="">不需要</option>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>
        <label><span className="label">優先程度</span><select className="field mt-2" value={preview.risk} onChange={(event) => change("risk", event.target.value as HandoffPreview["risk"])}><option value="low">一般</option><option value="medium">需要留意</option><option value="high">真正緊急／高風險</option></select></label>
        <label className="sm:col-span-2"><span className="label">需要物資</span><input className="field mt-2" value={preview.materialsRequired} onChange={(event) => change("materialsRequired", event.target.value)} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 p-3"><input className="h-5 w-5" type="checkbox" checked={preview.rnRequired} onChange={(event) => change("rnRequired", event.target.checked)} /><span className="font-semibold">需要安排 RN</span></label>
        <label className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 p-3"><input className="h-5 w-5" type="checkbox" checked={preview.clientUpdateRequired} onChange={(event) => change("clientUpdateRequired", event.target.checked)} /><span className="font-semibold">需要回覆家屬／客戶</span></label>
      </div>
      {duplicate ? <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><input className="mt-0.5 h-5 w-5" type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} /><span><span className="block font-extrabold text-amber-950">可能已有相同任務</span><span className="mt-1 block text-sm text-amber-900">先檢查；如確定是另一件工作，剔選後才建立。</span></span></label> : null}
      {message ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">{message}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" variant="secondary" disabled={saving} onClick={() => setPreview(null)}>返回修改原文</Button>
        <Button type="button" disabled={saving || (duplicate && !allowDuplicate)} onClick={() => void save()}><Save className="h-5 w-5" />{saving ? "安全儲存中…" : "確認並建立任務"}</Button>
      </div>
    </div>
  );
}
