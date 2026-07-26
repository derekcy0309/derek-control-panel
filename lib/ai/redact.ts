import { createHash } from "node:crypto";

const redactions: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  [/\b[A-Z]\d{6}\([0-9A]\)(?!\w)/gi, "[HKID]"],
  [/\b(?:\+?852[-\s]?)?[456789]\d{3}[-\s]?\d{4}\b/g, "[PHONE]"],
  [/\b\d{10,19}\b/g, "[ACCOUNT_NUMBER]"],
  [/\b[A-Z]{1,3}-?\d{4,12}\b/g, "[REFERENCE]"],
  [/(?:病人|客戶|兒童|小朋友|姓名|name)\s*[:：]\s*[^\s,，。;；]+/gi, "[NAME]"],
  [/(?:完整)?(?:地址|住址|address)\s*[:：]\s*[^\n\r]+/gi, "[ADDRESS]"]
];

export function redactSensitiveText(value: string) {
  return redactions.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  ).slice(0, 4000);
}

export function hashAIInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
