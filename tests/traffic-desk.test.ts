import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapRoad } from "../components/dayline/road-map.ts";
import type { Journey, RoadReport } from "../lib/roadwatch.ts";

const at = "2026-11-21T12:00:00Z";
const now = Date.parse(at);
const journey = (key: string, start: string, dest: string): Journey => ({
  key, origin: key.split(":")[0], start, dest, area: "九龍", status: "slow", minutes: 18, at,
});
const report = (roads: Journey[], spots: RoadReport["spots"] = []): RoadReport => ({
  at, roads, spots, notices: [], tolls: [], vehicle: "PC", fixedOK: false, variableOK: false, period: "weekday",
});

test("traffic atlas highlights the precise live journey origin, not a whole corridor", () => {
  const row = mapRoad("cht", report([journey("K04:CH", "公主道南行", "紅隧")]), now);
  assert.equal(row.value, "18 分鐘");
  assert.equal(row.subset, "公主道南行 → 紅隧");
  assert.equal(row.measurement?.mode, "journey");
  assert.match(row.point?.label ?? "", /公主道/);
  assert.equal(row.freshAlert?.key, "K04:CH");
});

test("an unmapped live reverse direction is never placed onto the mapped forward origin", () => {
  const row = mapRoad("cht", report([journey("H2:CH", "堅拿道天橋北行", "紅隧")]), now);
  assert.equal(row.measurement?.anchor, "H2");
  assert.equal(row.point, null);
  assert.equal(row.value, "18 分鐘");
});

test("inbound Tuen Mun is a detector speed; stale results cannot become a fresh value or alert", () => {
  const snap = report([journey("SJ5:TWTM", "屯門公路南行", "荃灣西")], [{ id: "TDS90020", label: "汀九西行入屯門", at, kph: 46 }]);
  const row = mapRoad("tm-in", snap, now);
  assert.equal(row.value, "46 km/h");
  assert.equal(row.measurement?.mode, "detector");
  assert.equal(row.roads.length, 0);
  const stale = mapRoad("tm-in", snap, now + 11 * 60_000);
  assert.equal(stale.value, "未有新數");
  assert.equal(stale.measurement, null);
  assert.equal(stale.freshAlert, undefined);
  assert.match(stale.point?.label ?? "", /汀九/);
});

test("traffic is a canonical standalone route with a legacy redirect, not a dashboard module", () => {
  const file = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
  assert.match(file("app/traffic/page.tsx"), /<AuthGate><TrafficDesk \/><\/AuthGate>/);
  assert.match(file("app/briefing/traffic/page.tsx"), /redirect\("\/traffic"\)/);
  assert.doesNotMatch(file("app/page.tsx"), /HomeRoads|RoadWatch|\/api\/hk-traffic/);
  assert.doesNotMatch(file("components/dayline/InfoChoices.tsx"), /<RoadWatch|首頁交通實況/);
});
