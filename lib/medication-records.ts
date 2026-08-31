export const medicationPresets = [
  "Ritalin",
  "Ritalin LA",
  "Concerta",
  "Vyvanse",
  "Atomextine",
  "其他藥物"
] as const;

export type MedicationPreset = (typeof medicationPresets)[number];

export function localToday(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function doseWithUnit(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return /\bmg\b\s*$/i.test(cleaned) ? cleaned : `${cleaned} mg`;
}

export function alternatingDateTone(index: number) {
  return index % 2 === 0 ? "bg-indigo-50/80 ring-indigo-100" : "bg-teal-50/80 ring-teal-100";
}
