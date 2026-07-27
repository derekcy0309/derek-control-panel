import assert from "node:assert/strict";
import test from "node:test";

// The runtime-owned Next.js config is JavaScript and has no emitted declaration file.
// @ts-expect-error importing the config is intentional for this runtime contract test
import nextConfig from "../next.config.mjs";

type HeaderRule = {
  source: string;
  headers: Array<{
    key: string;
    value: string;
  }>;
};

test("every route receives the baseline browser security headers", async () => {
  assert.equal(typeof nextConfig.headers, "function");

  const rules = await nextConfig.headers() as HeaderRule[];
  const globalRule = rules.find((rule) => rule.source === "/(.*)");

  assert.ok(globalRule);

  const headers = Object.fromEntries(
    globalRule.headers.map(({ key, value }) => [key.toLowerCase(), value])
  );

  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(
    headers["permissions-policy"],
    "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()"
  );
});
