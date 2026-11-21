"use client";

import Image from "next/image";
import { MapPin, Radio, RefreshCw, Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { recentReading, roadWords, trafficHighlights, roadSource, tollTable, type Journey, type RoadReport } from "@/lib/roadwatch";
import { useInfoChoices } from "./InfoChoices";
import { FaresNow, RoutePicker, type RoadChoiceModel } from "./RoadPresets";
import { mapRoad } from "./road-map";

const hkt = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const readyAt = (s: string) => Number.isFinite(Date.parse(s)) ? hkt.format(new Date(s)) : "時間不詳";

function RoadLine({ r, now }: { r: Journey; now: number }) {
  const live = recentReading(r.at, now);
  return <li className="dl-road-line"><div><strong>{r.start}</strong><span>往 {r.dest}</span></div><div>
    <b data-state={live ? r.status : "unknown"}>{live ? roadWords[r.status] : "資料較舊"}</b>
    {live && r.minutes !== null ? <span>約 {r.minutes} 分鐘</span> : null}
    <small>量度 {readyAt(r.at)}</small>
  </div></li>;
}

function RoadAtlas({ groups, selected }: {
  groups: ReturnType<typeof mapRoad>[];
  selected: ReturnType<typeof mapRoad> | undefined;
}) {
  return <figure className="dl-road-atlas">
    <div className="dl-road-atlas-frame">
      <Image src="/dayline/traffic-map.svg" alt="" width={640} height={382} unoptimized />
      <svg className="dl-road-pins" viewBox="0 0 640 382" aria-hidden="true">
        {[...groups].sort((a, b) => Number(a.key === selected?.key) - Number(b.key === selected?.key)).map(group => group.point ?
          <g className="dl-road-pin" data-selected={group.key === selected?.key} key={group.key} transform={`translate(${group.point.x} ${group.point.y})`}>
            <circle r="12" /><text textAnchor="middle" y="4">{groups.indexOf(group) + 1}</text>
          </g> : null)}
      </svg>
      <span className="dl-road-north" aria-hidden="true">↑ N</span>
    </div>
    <figcaption>
      <strong><MapPin aria-hidden="true" size={16} />{selected?.point?.label ?? "香港西部道路"}</strong>
      <span>{selected?.point ? selected.measurement?.mode === "detector" ? "單一測速點，唔係全程需時。" : "標示量度位置，唔代表整段路況。" :
        selected ? "呢個方向嘅量度位置未有喺地圖標出，請睇清單。" : "揀定路段後會標示已知量度位置。"}</span>
    </figcaption>
  </figure>;
}

export function TrafficDesk() {
  return <RoadWatch model={useInfoChoices()} />;
}

function RoadWatch({ model }: { model: RoadChoiceModel }) {
  const [editing, edit] = useState(false);
  const [saved, saySaved] = useState(false);
  const [data, setData] = useState<RoadReport | null>(null);
  const [vehicle, setVehicle] = useState<"PC" | "MC">("PC");
  const [area, setArea] = useState("全部");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    let inFlight = false;
    const controller = new AbortController();
    const { signal } = controller;
    async function read() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      setBusy(true);
      try {
        const result = await fetch("/api/hk-traffic?vehicle=" + vehicle, { cache: "no-store", credentials: "omit", signal });
        if (!result.ok) throw Error();
        const report = await result.json() as RoadReport;
        if (!signal.aborted) {
          setData(report);
          setNow(Date.now());
          setError(false);
        }
      } catch {
        if (!signal.aborted) setError(true);
      } finally {
        inFlight = false;
        if (!signal.aborted) setBusy(false);
      }
    }
    void read();
    let minute = Math.floor(Date.now() / 60_000);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const at = Date.now();
      setNow(at);
      if (Math.floor(at / 60_000) !== minute) {
        minute = Math.floor(at / 60_000);
        void read();
      }
    }, 5_000);
    const visible = () => { if (!document.hidden) { setNow(Date.now()); void read(); } };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [vehicle, revision]);

  const readings = data?.roads ?? [];
  const groups = useMemo(() => model.routes.map(k => mapRoad(k, data, now)), [model.routes, data, now]);
  const selected = groups.find(g => g.key === choice) ?? groups[0];
  const attention = trafficHighlights(groups.flatMap(g => g.freshAlert ? [g.freshAlert] : []), now, 1)[0];
  const high = trafficHighlights(readings, now).filter(r => r.status !== "clear");
  const find = search.trim();
  const matches = readings.filter(r => (area === "全部" || r.area === area) && (!find || [r.start, r.dest].some(s => s.includes(find))));
  const snapshotAge = data ? now - Date.parse(data.at) : Infinity;
  const expired = !Number.isFinite(snapshotAge) || snapshotAge > 120_000 || snapshotAge < -120_000;

  return <section className="dl-roadpage dl-road-desk" aria-labelledby="dl-traffic-title">
    <header className="dl-road-heading">
      <div><span className="dl-section-kicker">HONG KONG / ROAD DESK</span><h1 id="dl-traffic-title">交通實況</h1><p>常行路線、特別交通消息同隧道收費</p></div>
      <div className="dl-road-toolbar">
        <small>{data ? <>上次查詢：<time dateTime={data.at}>{readyAt(data.at)}</time>（香港時間）</> : null}</small>
        <button type="button" disabled={busy} className="dl-road-action" onClick={() => setRevision(x => x + 1)}><RefreshCw aria-hidden="true" size={15} />{busy ? "更新緊…" : "更新路況"}</button>
      </div>
    </header>

    {error ? <p className="dl-road-status" role="status">暫時更新唔到。{data ? "以下保留上次資料，請留意量度時間。" : "請檢查連線，再撳「更新路況」。"}</p> : !data ? <p className="dl-road-status" role="status">讀取運輸署路況中…</p> : null}
    {attention ? <div className="dl-road-attention"><Route size={19} aria-hidden="true" /><div><span>常行路線 · 值得留意</span><strong>{attention.start} → {attention.dest}：{roadWords[attention.status]}</strong></div></div> : null}

    <div className="dl-road-board">
      <RoadAtlas groups={groups} selected={selected} />
      <section className="dl-road-watch" aria-label="常行路線">
        <div className="dl-road-sectionhead">
          <div><span className="dl-section-kicker">WATCHLIST</span><h2>我常行嘅路</h2></div>
          <button type="button" className="dl-road-action" disabled={!model.ready} aria-expanded={editing} onClick={() => { edit(!editing); saySaved(false); }}>揀路段</button>
        </div>
        {model.busy ? <small role="status">儲存緊你嘅交通設定…</small> : null}
        {model.error && !editing ? <p role="alert">{model.error} <button type="button" onClick={model.retry}>重試</button></p> : null}
        {editing ? <RoutePicker model={model} roads={readings} onDone={ok => { edit(false); saySaved(ok); }} /> : saved ? <small role="status">已儲存路段。</small> : null}
        {groups.length ? <ul className="dl-road-choices">{groups.map((group, index) =>
          <li key={group.key}>
            <button type="button" className="dl-road-choice" aria-pressed={selected?.key === group.key} onClick={() => setChoice(group.key)}>
              <span className="dl-road-index">{index + 1}</span><span className="dl-road-name"><strong>{group.label}</strong><small>{group.subset}</small></span>
              <span className="dl-road-value">{group.value}</span>
            </button>
          </li>)}</ul> : <p>未揀路段，可以撳「揀路段」加入。</p>}
        {selected ? <div className="dl-road-selected">
          <h3>{selected.label} · 各方向讀數</h3>
          {selected.roads.length ? <ul className="dl-road-list">{selected.roads.map(r => <RoadLine key={r.key} r={r} now={now} />)}</ul> : null}
          {selected.spots.length ? <ul className="dl-road-list">{selected.spots.map(s => <li key={s.id} className="dl-road-line"><div><strong>{s.label}</strong><span>單一測速點</span></div><div><strong>{recentReading(s.at, now) ? s.kph + " km/h" : "資料較舊"}</strong><small>量度 {readyAt(s.at)}</small></div></li>)}</ul> : null}
          {!selected.roads.length && !selected.spots.length ? <p>暫未有呢個方向嘅讀數，唔代表道路暢順。</p> : null}
        </div> : null}
      </section>
    </div>

    <FaresNow data={data} now={now} vehicle={vehicle} change={setVehicle} />

    <div className="dl-road-more">
      <section className="dl-road-block"><h3><Radio aria-hidden="true" size={17} />特別交通消息</h3>
        {!data?.notices || expired ? <p>未能確認最新交通消息，唔代表冇事故。</p> :
          data.notices.length ? <ul>{data.notices.map(n => <li key={n.id}><div><strong>{n.place}{n.direction && " · 往" + n.direction}</strong><p>{n.body}</p><small>運輸署公布：{readyAt(n.at)}</small></div></li>)}</ul> :
            <p>最近一次成功查詢，運輸署暫無生效消息。</p>}
      </section>
      <div>
        <details><summary>全港較繁忙嘅路段</summary><p>按運輸署行車時間顯示器；唔代表全港每一段路。</p>{high.length ? <ul className="dl-road-list">{high.map(r => <RoadLine key={r.key} r={r} now={now} />)}</ul> : <p>暫未有需特別留意嘅最新讀數；唔代表道路暢順。</p>}</details>
        <details><summary>睇各區路段／揀方向</summary><div className="dl-linkform"><label>出發地區<select value={area} onChange={e => setArea(e.target.value)}>{["全部", "港島", "九龍", "新界"].map(a => <option key={a}>{a}</option>)}</select></label><label>搵道路或目的地<input value={search} onChange={e => setSearch(e.target.value)} placeholder="例如：屯門、獅子山、東隧" /></label></div>
          {matches.length ? <ul className="dl-road-list">{matches.map(r => <RoadLine key={r.key} r={r} now={now} />)}</ul> : <p>呢個範圍暫時未有顯示器讀數。</p>}</details>
        <details><summary>其他主要固定收費</summary>{data?.fixedOK && !expired ? <ul className="dl-fares">{data.tolls.filter(t => !t.variable).map(t => <li key={t.name}><span>{t.name}</span><strong>HK$ {t.fee}</strong></li>)}</ul> : <p>未能核實最新固定收費。</p>}</details>
      </div>
    </div>
    <footer className="dl-news-foot">此頁開住時每分鐘再查。資料：<a href={roadSource} rel="noreferrer" target="_blank">運輸署行車時間</a>、<a href={tollTable} rel="noreferrer" target="_blank">隧道收費表</a>。底圖：運輸署道路中心線、民政事務總署分區界線、Natural Earth。駕駛途中請勿操作。</footer>
  </section>;
}
