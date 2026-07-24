import { WifiOff } from "lucide-react";

export default function OfflinePage() { return <main className="grid min-h-screen place-items-center bg-mist px-5"><section className="panel max-w-md p-7 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-600"><WifiOff className="h-5 w-5" /></div><h1 className="mt-4 text-2xl font-bold">目前離線</h1><p className="muted mt-2 text-sm leading-6">為保護私人資料，系統不會把 Dashboard、任務或敏感內容保存在離線 cache。連線恢復後請重新整理。</p></section></main>; }
