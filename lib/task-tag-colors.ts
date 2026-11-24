import type { CSSProperties } from "react";

type TagIdentity = { id: string; legacy_key?: string | null };

const establishedHues = new Map<string, number>([
  ["personal", 173], ["family", 273], ["sec", 34], ["wecare", 220],
  ["priority_p1", 347], ["priority_p2", 197], ["priority_p3", 119],
]);
const paletteCache = new WeakMap<readonly TagIdentity[], ReadonlyMap<string, CSSProperties>>();

function baseHue(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % 360;
}

// All task surfaces use the full active catalogue, not the visible subset.
// Sorting by immutable ID keeps colours independent of names and list order;
// probing 137° (coprime with 360) prevents two Tags in one account sharing a hue.
export function taskTagColors(tags: readonly TagIdentity[]): ReadonlyMap<string, CSSProperties> {
  const cached = paletteCache.get(tags);
  if (cached) return cached;
  const palette = new Map<string, CSSProperties>();
  const assignedEstablished = new Set<number>();
  const used = new Set(establishedHues.values());
  for (const tag of [...tags].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (palette.has(tag.id)) continue;
    const established = establishedHues.get(tag.legacy_key ?? "");
    let hue: number;
    if (established !== undefined && !assignedEstablished.has(established)) {
      hue = established;
      assignedEstablished.add(hue);
    } else {
      hue = baseHue(tag.id);
      for (let tries = 0; tries < 360 && used.has(hue); tries++) hue = (hue + 137) % 360;
      used.add(hue);
    }
    // Alternate tint levels too, so adjacent hues don't round to the same RGB.
    palette.set(tag.id, { "--task-tag-hue": hue, "--task-tag-tint": hue % 6 } as CSSProperties);
  }
  paletteCache.set(tags, palette);
  return palette;
}
