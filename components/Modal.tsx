"use client";

import { useEffect, useRef } from "react";
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
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    function handleKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[92dvh] w-full max-w-3xl overflow-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="modal-title" className="text-2xl font-bold text-ink">{title}</h2>
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
