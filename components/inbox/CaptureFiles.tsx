"use client";

import { useState } from "react";
import { FileAudio, FileText, ImageIcon, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction, loadInboxCaptureFiles } from "@/lib/control-api";
import type { InboxCaptureFile } from "@/lib/types";

export function CaptureFiles({ inboxItemId }: { inboxItemId: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<InboxCaptureFile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setMessage("");
    try {
      const result = await loadInboxCaptureFiles(inboxItemId);
      setFiles(result.files);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能讀取附件。");
    }
  }

  async function openFile(file: InboxCaptureFile) {
    setBusyId(file.id);
    setMessage("");
    try {
      const result = await controlAction<{ url: string }>("open_inbox_capture_file", { id: file.id });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能開啟附件。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
      <Button type="button" variant="secondary" onClick={() => void toggle()}>
        <Paperclip className="h-4 w-4" />{open ? "收起附件" : "查看私人附件"}
      </Button>
      {open && files === null && !message ? <p className="mt-2 text-xs text-slate-600">正在讀取附件…</p> : null}
      {open && files?.length === 0 ? <p className="mt-2 text-xs text-slate-600">附件仍在上載或只對建立者可見。</p> : null}
      {open && files?.length ? <div className="mt-3 space-y-2">{files.map((file) => <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm" key={file.id}><span className="flex min-w-0 items-center gap-2 font-semibold"><CaptureFileIcon kind={file.file_kind} />{file.file_name}</span><Button type="button" variant="ghost" disabled={busyId === file.id} onClick={() => void openFile(file)}>{busyId === file.id ? "開啟中…" : "開啟"}</Button></div>)}</div> : null}
      {message ? <p className="mt-2 text-xs font-semibold text-amber-900" role="alert">{message}</p> : null}
    </section>
  );
}

function CaptureFileIcon({ kind }: { kind: InboxCaptureFile["file_kind"] }) {
  const className = "h-4 w-4 shrink-0 text-indigo-600";
  if (kind === "photo") return <ImageIcon className={className} />;
  if (kind === "audio") return <FileAudio className={className} />;
  return <FileText className={className} />;
}
