import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cssColourMode, normalizeVisualIntensity, normalizeVisualTheme, sectionIdentityForPath } from "../lib/appearance.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("legacy appearance values map safely to the four visual themes", () => {
  assert.equal(normalizeVisualTheme("light"), "sunrise");
  assert.equal(normalizeVisualTheme("dark"), "night_shift");
  assert.equal(normalizeVisualTheme("system", true), "night_shift");
  assert.equal(normalizeVisualTheme("ocean"), "ocean");
  assert.equal(cssColourMode("night_shift"), "dark");
  assert.equal(normalizeVisualIntensity("unexpected"), "balanced");
});

test("page identity uses stable semantic sections", () => {
  assert.equal(sectionIdentityForPath("/"), "today");
  assert.equal(sectionIdentityForPath("/workspace/family"), "family");
  assert.equal(sectionIdentityForPath("/workspace/health"), "health");
  assert.equal(sectionIdentityForPath("/cashflow"), "finance");
  assert.equal(sectionIdentityForPath("/tasks"), "work");
});

test("appearance migration is additive and themes never alter work data", () => {
  const migration = read("supabase/migrations/20260910120000_visual_themes.sql").toLowerCase();
  const rollback = read("supabase/migrations/20260910120000_visual_themes.rollback.sql").toLowerCase();
  assert.match(migration, /add column if not exists visual_intensity/);
  assert.match(migration, /sunrise.*ocean.*aurora.*night_shift/);
  assert.doesNotMatch(migration, /(?:update|delete|alter table) public\.(?:tasks|operating_items|assignments)/);
  assert.match(rollback, /drop column if exists visual_intensity/);
});

test("today dashboard exposes one immediate action before secondary tasks", () => {
  const dashboard = read("components/RoleDailyDashboard.tsx");
  assert.match(dashboard, /現在只做這一件/);
  assert.match(dashboard, /開始 5 分鐘/);
  assert.match(dashboard, /我開始唔到/);
  assert.match(dashboard, /visibleTop\[0\]/);
});
