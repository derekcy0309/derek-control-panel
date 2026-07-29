import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("email-link session adoption never signs out the newly authenticated user", async () => {
  const source = await readFile(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.match(source, /action: "adopt"/);
  assert.match(source, /window\.location\.replace\(window\.location\.pathname\)/);
  assert.doesNotMatch(source, /supabase\?\.auth\.signOut\(/);
});
