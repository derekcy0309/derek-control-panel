import { watchGroup } from "../../lib/road-presets.ts";
import { recentReading, roadWords, type Journey, type RoadReport } from "../../lib/roadwatch.ts";

// Coordinates are in the same 640 × 382 projection as public/dayline/traffic-map.svg.
// Origins: TD Journey Time Indicators v2 spec and speed detector location table.
const anchors: Record<string, { x: number; y: number; label: string }> = {
  K04: { x: 489.7, y: 288.4, label: "公主道南行・近愛民邨" },
  TDS90020: { x: 351.4, y: 197.2, label: "屯門公路・近汀九西行測速點" },
  SJ5: { x: 189.6, y: 145.7, label: "屯門公路南行・近井財街" },
  SJ4: { x: 304.5, y: 43.3, label: "新田公路南行・近錦綉花園" },
  N02: { x: 248.1, y: 81.7, label: "朗天路南行・近柏麗豪園" },
};

const presetAnchors: Record<string, string> = {
  cht: "K04", "tm-in": "TDS90020", "tm-out": "SJ5", r3: "SJ4", airport: "N02",
};

function isUseful(road: Journey) {
  return road.status !== "unknown" || road.minutes !== null;
}

export function mapRoad(key: string, report: RoadReport | null, now: number) {
  const group = watchGroup(key, report?.roads ?? [], report?.spots ?? []);
  const nominal = presetAnchors[key] ?? key.split(":")[0];
  const road = group.roads.find(r => recentReading(r.at, now) && isUseful(r));
  const spot = group.spots.find(s => recentReading(s.at, now));
  const measurement = road ? { anchor: road.origin, mode: "journey" as const, at: road.at } :
    spot ? { anchor: spot.id, mode: "detector" as const, at: spot.at } : null;
  // A valid reading may be from a different origin than the first mapped direction.
  // Never draw that reading on the nominal point when its own coordinate is unavailable.
  const anchorKey = measurement?.anchor ?? nominal;
  const point = Object.hasOwn(anchors, anchorKey) ? anchors[anchorKey] : null;
  const freshAlert = group.roads.find(r => recentReading(r.at, now) && (r.status === "closed" || r.status === "jam" || r.status === "slow"));
  const value = road ? road.minutes === null ? roadWords[road.status] : `${road.minutes} 分鐘` : spot ? `${spot.kph} km/h` : "未有新數";
  const subset = road ? `${road.start} → ${road.dest}` : spot?.label ?? (group.roads.length || group.spots.length ? "讀數未能反映現況" : "暫未有呢個方向嘅讀數");
  return { key, ...group, value, subset, measurement, point, freshAlert };
}
