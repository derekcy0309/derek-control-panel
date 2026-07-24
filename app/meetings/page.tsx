"use client";

import { useState } from "react";
import { Archive, FilePlus2, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { MeetingForm } from "@/components/forms/MeetingForm";
import { TaskForm } from "@/components/forms/TaskForm";
import { Button } from "@/components/ui/Button";
import { ScopeBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/date";
import { scopeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Meeting } from "@/lib/types";
import { useAppData } from "@/hooks/useAppData";

export default function MeetingsPage() {
  return (
    <AuthGate>
      <MeetingsContent />
    </AuthGate>
  );
}

function MeetingsContent() {
  const { data, userId, participants, loading, error, reload } = useAppData();
  const [isAdding, setIsAdding] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [taskSource, setTaskSource] = useState<Meeting | null>(null);

  if (loading || error || !userId) return <LoadingState error={error} />;

  async function archiveMeeting(meeting: Meeting) {
    await controlAction("save_meeting", { ...meeting, id: meeting.id, archived_at: new Date().toISOString() });
    reload();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-soft">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-amber-700">會議結束前要收口</p>
            <h2 className="mt-1 text-2xl font-bold text-ink">會議</h2>
            <p className="mt-2 text-base font-semibold text-amber-900">每個會議未產生行動清單，就等於會議未完。</p>
          </div>
          <Button onClick={() => setIsAdding(true)}>
            <Plus className="h-5 w-5" />
            新增會議
          </Button>
        </div>
      </section>

      <section className="grid gap-4">
        {data.meetings.length ? (
          data.meetings.map((meeting) => (
            <article key={meeting.id} className="panel p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <ScopeBadge scope={meeting.scope} />
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{formatDate(meeting.meeting_date)}</span>
                  </div>
                  <h3 className="mt-3 text-xl font-bold text-ink">{meeting.meeting_name}</h3>
                  <p className="mt-2 text-base text-slate-600">{scopeLabels[meeting.scope]}會議紀錄</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setEditingMeeting(meeting)}>
                    修改
                  </Button>
                  <Button variant="secondary" onClick={() => setTaskSource(meeting)}>
                    <FilePlus2 className="h-5 w-5" />
                    建立行動任務
                  </Button>
                  <Button variant="ghost" onClick={() => archiveMeeting(meeting)}>
                    <Archive className="h-5 w-5" />
                    封存
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextBlock title="粗略會議內容" text={meeting.raw_notes || "未輸入內容。"} />
                <TextBlock title="手動摘要" text={meeting.summary || "未輸入摘要。"} />
              </div>
            </article>
          ))
        ) : (
          <div className="panel p-5 text-base text-slate-600">暫時沒有會議紀錄。</div>
        )}
      </section>

      {isAdding ? (
        <Modal title="新增會議" onClose={() => setIsAdding(false)}>
          <MeetingForm userId={userId} onSaved={() => finish(reload, () => setIsAdding(false))} onCancel={() => setIsAdding(false)} />
        </Modal>
      ) : null}

      {editingMeeting ? (
        <Modal title="修改會議" onClose={() => setEditingMeeting(null)}>
          <MeetingForm
            userId={userId}
            initialMeeting={editingMeeting}
            onSaved={() => finish(reload, () => setEditingMeeting(null))}
            onCancel={() => setEditingMeeting(null)}
          />
        </Modal>
      ) : null}

      {taskSource ? (
        <Modal title="由會議建立行動任務" onClose={() => setTaskSource(null)}>
          <TaskForm
            userId={userId}
            participants={participants}
            preset={{
              scope: taskSource.scope,
              source_type: "meeting_action",
              title: taskSource.meeting_name,
              notes: taskSource.summary || taskSource.raw_notes || ""
            }}
            onSaved={() => finish(reload, () => setTaskSource(null))}
            onCancel={() => setTaskSource(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-800">{text}</p>
    </div>
  );
}

function finish(reload: () => void, close: () => void) {
  reload();
  close();
}
