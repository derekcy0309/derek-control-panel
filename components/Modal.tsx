"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <section className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-ink">{title}</h2>
          <Button variant="ghost" onClick={onClose} title="關閉">
            <X className="h-5 w-5" />
            關閉
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
