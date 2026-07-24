"use client";

import { GitCommitHorizontal } from "lucide-react";

const buildInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? "",
  commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown",
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "unknown"
};

export function BuildInfo() {
  return (
    <section className="panel p-5" aria-labelledby="build-info-title">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <GitCommitHorizontal className="h-5 w-5" />
        </div>
        <div>
          <p className="eyebrow">About</p>
          <h2 id="build-info-title" className="section-title mt-1">版本及部署資料</h2>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <BuildValue label="App version" value={`v${buildInfo.version}`} />
        <BuildValue label="Environment" value={buildInfo.environment} />
        <BuildValue label="Commit SHA" value={shortSha(buildInfo.commitSha)} title={buildInfo.commitSha} mono />
        <BuildValue label="Build time" value={formatBuildTime(buildInfo.buildTime)} />
      </dl>
    </section>
  );
}

function BuildValue({ label, value, title, mono = false }: { label: string; value: string; title?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{label}</dt>
      <dd className={`mt-1 font-semibold text-slate-800 ${mono ? "font-mono" : ""}`} title={title}>{value}</dd>
    </div>
  );
}

function shortSha(value: string) {
  return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 12) : value;
}

function formatBuildTime(value: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
