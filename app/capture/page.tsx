"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileUp, Link2, Mic, MicOff, Send, Upload, Volume2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/Button";
import { useControlData } from "@/hooks/useControlData";

export default function CapturePage() {
  return <AuthGate><CaptureContent /></AuthGate>;
}

function CaptureContent() {
  const { data, loading, error } = useControlData();
  const [content, setContent] = useState("");
  const [area, setArea] = useState<"work" | "family" | "personal">("personal");
  const [targetUserId, setTargetUserId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentKind, setAttachmentKind] = useState<"photo" | "document" | "audio" | null>(null);
  const [rawAudioRetained, setRawAudioRetained] = useState(false);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const captureId = useRef<string | null>(null);
  const fileId = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sharedLoaded = useRef(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
      recognitionRef.current?.abort?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (sharedLoaded.current) return;
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title")?.trim() ?? "";
    const text = params.get("text")?.trim() ?? "";
    const url = params.get("url")?.trim() ?? "";
    if (!title && !text && !url) return;
    sharedLoaded.current = true;
    setContent([title, text].filter(Boolean).join("\n\n") || url);
    setSourceUrl(url);
    if (url) setMessage("已帶入分享內容；確認一句描述後即可存進收集箱。");
  }, []);

  if (loading || !data) return <LoadingState error={error} />;

  function chooseFile(file: File | null, kind: "photo" | "document") {
    setAttachment(file);
    setAttachmentKind(file ? kind : null);
    fileId.current = file ? crypto.randomUUID() : null;
    setMessage("");
  }

  async function startVoice() {
    setMessage("");
    const voiceWindow = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const Recognition = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("此瀏覽器未支援語音轉文字；可直接輸入，或選擇音訊檔保留到收集箱。");
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
      if (finalText.trim()) setContent((current) => [current.trim(), finalText.trim()].filter(Boolean).join(" "));
    };
    recognition.onerror = () => setMessage("語音轉文字暫時未能使用；你仍可直接輸入或重試。");
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);

    if (rawAudioRetained && "MediaRecorder" in window) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined });
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          if (!chunks.length) return;
          const type = recorder.mimeType || "audio/webm";
          const file = new File([new Blob(chunks, { type })], "voice-" + new Date().toISOString().replace(/[:.]/g, "-") + ".webm", { type });
          setAttachment(file);
          setAttachmentKind("audio");
          fileId.current = crypto.randomUUID();
        };
        recorderRef.current = recorder;
        recorder.start();
      } catch {
        setMessage("已開始語音轉文字；原始錄音未能取得，文字仍可正常儲存。");
      }
    }
  }

  function stopVoice() {
    recognitionRef.current?.stop?.();
    recorderRef.current?.stop?.();
    recorderRef.current = null;
    setListening(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      setMessage("先記下一句內容就可以了。");
      return;
    }
    if (!online) {
      setMessage("目前離線，未能安全上載。請保持此頁，網絡恢復後再按儲存。");
      return;
    }
    setSaving(true);
    setMessage("");
    captureId.current ??= crypto.randomUUID();
    if (attachment && !fileId.current) fileId.current = crypto.randomUUID();
    const source = sourceUrl ? "web" : attachmentKind === "photo" ? "photo" : attachmentKind === "document" ? "document" : attachmentKind === "audio" || listening ? "voice" : "text";
    const body = new FormData();
    body.set("clientCaptureId", captureId.current);
    body.set("title", trimmed.slice(0, 500));
    body.set("description", trimmed.length > 500 ? trimmed : "");
    body.set("area", area);
    body.set("source", source);
    if (targetUserId) body.set("targetUserId", targetUserId);
    if (sourceUrl) body.set("sourceUrl", sourceUrl);
    if (attachment) {
      body.set("file", attachment);
      body.set("clientFileId", fileId.current!);
      body.set("rawAudioRetained", String(rawAudioRetained && attachmentKind === "audio"));
    }
    try {
      const response = await fetch("/api/quick-capture", { method: "POST", credentials: "same-origin", body });
      const result = await response.json().catch(() => ({})) as { error?: string; uploaded?: boolean; retryable?: boolean };
      if (!response.ok) {
        setMessage(result.error || "內容已保留或尚未儲存，請重試。");
        return;
      }
      const hasFile = Boolean(attachment);
      setContent("");
      setSourceUrl("");
      setAttachment(null);
      setAttachmentKind(null);
      setRawAudioRetained(false);
      captureId.current = null;
      fileId.current = null;
      setMessage(hasFile ? "已安全存進收集箱，附件亦已上載。" : "已存進收集箱；稍後可逐項決定下一步。");
    } catch {
      setMessage("網絡暫時中斷。請保持此頁後按重試；系統會使用同一個識別碼避免重複建立。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <section className="rounded-2xl bg-white p-5 shadow-soft sm:p-7">
        <p className="eyebrow">Mobile Quick Capture</p>
        <h1 className="page-title mt-1">先收集，不用現在決定</h1>
        <p className="muted mt-2 text-sm leading-6">任何內容先安全放入現有收集箱。之後才安排、交接或整理，不會自動建立任務。</p>
      </section>

      {!online ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">目前離線。文字仍留在這個畫面；網絡恢復後可重試，避免遺失。</p> : null}

      <form className="panel space-y-5 p-4 sm:p-6" onSubmit={(event) => void submit(event)}>
        <label className="block"><span className="label">想先記下甚麼？</span><textarea className="field mt-2 min-h-36 text-base" value={content} onChange={(event) => setContent(event.target.value)} placeholder="例如：下星期要問學校有關活動安排" autoFocus /></label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">放到哪個範圍</span><select className="field mt-2" value={area} onChange={(event) => setArea(event.target.value as typeof area)}><option value="work">工作</option><option value="family">家庭</option><option value="personal">個人</option></select></label>
          <label><span className="label">預設後續處理者</span><select className="field mt-2" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}><option value="">先由我收集</option>{data.participants.filter((person) => person.user_id !== data.currentUser.id).map((person) => <option key={person.user_id} value={person.user_id}>之後交給 {person.display_name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">只作後續處理提示，未經你確認不會自動交辦或分享內容。</span></label>
        </div>

        <section className="grid gap-2 sm:grid-cols-3" aria-label="快速收集方式">
          <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50"><Camera className="h-5 w-5 text-indigo-600" />拍相<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0] ?? null, "photo")} /></label>
          <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50"><FileUp className="h-5 w-5 text-indigo-600" />文件<input className="sr-only" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => chooseFile(event.target.files?.[0] ?? null, "document")} /></label>
          <Button type="button" variant={listening ? "danger" : "secondary"} onClick={() => listening ? stopVoice() : void startVoice()} disabled={saving}>{listening ? <><MicOff className="h-5 w-5" />停止語音</> : <><Mic className="h-5 w-5" />語音轉文字</>}</Button>
        </section>

        <label className="block"><span className="label">分享網址（可選）</span><div className="relative mt-2"><Link2 className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><input className="field pl-10" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…（PWA 分享內容會自動帶入）" /></div></label>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-0.5 h-5 w-5" type="checkbox" checked={rawAudioRetained} onChange={(event) => setRawAudioRetained(event.target.checked)} /><span><span className="flex items-center gap-1 font-semibold"><Volume2 className="h-4 w-4" />保留原始錄音</span><span className="muted mt-1 block text-xs leading-5">只在你語音收集時保留；不剔選便只儲存轉出的文字。原始錄音預設私人。</span></span></label>

        {attachment ? <p className="rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900"><Upload className="mr-1 inline h-4 w-4" />已選擇：{attachment.name}（{Math.max(1, Math.ceil(attachment.size / 1024))} KB）</p> : null}
        {message ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">{message}</p> : null}
        <Button className="w-full" type="submit" disabled={saving || !online}>{saving ? "安全儲存中…" : <><Send className="h-5 w-5" />存進收集箱</>}</Button>
      </form>

      <p className="muted px-2 text-xs leading-5">相片、文件和原始錄音最多 12 MB，預設私人。若瀏覽器不支援 PWA 分享或語音轉文字，仍可直接輸入、貼上網址或選擇檔案。</p>
    </main>
  );
}
