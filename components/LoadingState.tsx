export function LoadingState({ error }: { error?: string }) {
  if (error) {
    return <div className="panel p-5" role="alert"><p className="text-base font-semibold text-red-700">{error}</p><button className="mt-4 min-h-11 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200" onClick={() => window.location.reload()}>重新嘗試</button></div>;
  }

  return <div className="space-y-3" role="status" aria-label="載入資料中"><div className="h-28 animate-pulse rounded-2xl bg-slate-200/70" /><div className="grid gap-3 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" /><div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" /></div></div>;
}
