export function LoadingState({ error }: { error?: string }) {
  if (error) {
    return <div className="panel p-5 text-base font-semibold text-red-700">{error}</div>;
  }

  return <div className="panel p-5 text-base font-semibold text-slate-700">載入資料中...</div>;
}
