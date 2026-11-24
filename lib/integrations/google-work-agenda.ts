import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import {
  GOOGLE_WORK_SOURCE,
  briefTimezone,
  type BriefEvent,
  type CalendarReadWindow
} from "../calendar-brief.ts";

const GOOGLE_CALENDAR_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/";
const GOOGLE_AGENDA_FIELDS = "nextPageToken,items(id,summary,status,visibility,start(date,dateTime,timeZone),end(date,dateTime,timeZone),extendedProperties/private)";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const MAX_EVENTS = 200;
const MAX_BODY_BYTES = 512 * 1024;
const TOTAL_TIMEOUT_MS = 5000;
const GOOGLE_RECONNECT = "GOOGLE_RECONNECT";
const GOOGLE_UNAVAILABLE = "GOOGLE_UNAVAILABLE";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function civilDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try { return Temporal.PlainDate.from(value).toString() === value ? value : null; }
  catch { return null; }
}

function timedDate(value: Record<string, unknown> | null) {
  if (!value) return null;
  const dateTime = value.dateTime;
  if (typeof dateTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/i.test(dateTime)) return null;
  try {
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(dateTime)) {
      return Temporal.Instant.from(dateTime).toString({ smallestUnit: "millisecond" });
    }
    if (typeof value.timeZone !== "string" || !value.timeZone || value.timeZone.length > 100) return null;
    return Temporal.PlainDateTime.from(dateTime).toZonedDateTime(value.timeZone).toInstant().toString({ smallestUnit: "millisecond" });
  } catch { return null; }
}

function googleEvent(value: unknown, calendarId: string, window: CalendarReadWindow): BriefEvent | null {
  const row = record(value);
  const googleId = row?.id;
  if (!row || typeof googleId !== "string" || !googleId || googleId.length > 1024 || row.status === "cancelled") return null;
  const marker = record(record(row.extendedProperties)?.private)?.dcpItemId;
  // Outbound Dayline copies have a private marker and a stable dcp-prefixed ID.
  // Prefer neither title nor time matching: unrelated native events can match both.
  if ((typeof marker === "string" && marker.length > 0) || /^dcp[a-f\d]{32}$/.test(googleId)) return null;

  const from = record(row.start);
  const until = record(row.end);
  const allDay = typeof from?.date === "string" || typeof until?.date === "string";
  const start = allDay ? civilDate(from?.date) : timedDate(from);
  const end = allDay ? civilDate(until?.date) : timedDate(until);
  if (!start || !end) return null;
  if (allDay) {
    if (end <= start || start >= window.until || end <= window.from) return null;
  } else {
    const lower = Date.parse(window.start), upper = Date.parse(window.end);
    const startsAt = Date.parse(start), endsAt = Date.parse(end);
    if (endsAt < startsAt || startsAt >= upper || (startsAt === endsAt ? startsAt < lower : endsAt <= lower)) return null;
  }

  const label = typeof row.summary === "string"
    ? row.summary.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  const title = row.visibility !== undefined && row.visibility !== "default" && row.visibility !== "public"
    ? "私人行程"
    : label || "Google Calendar 行程";
  const id = "google-work:" + createHash("sha256").update(calendarId + "\0" + googleId).digest("hex").slice(0, 32);
  return { id, uid: id, title, start, end, allDay, source: GOOGLE_WORK_SOURCE, tentative: row.status === "tentative" };
}

// Limit even a malformed provider response and never return/log its body on error.
async function jsonRecord(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(GOOGLE_UNAVAILABLE);
    }
    chunks.push(value);
  }
  return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

async function providerError(response: Response) {
  if (response.status === 403) {
    const body = await jsonRecord(response).catch(() => null);
    const reasons = record(body?.error)?.errors;
    if (Array.isArray(reasons) && reasons.some(value => {
      const detail = record(value);
      return detail?.domain === "usageLimits" || ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"].some(reason => reason === detail?.reason);
    })) return GOOGLE_UNAVAILABLE;
  } else {
    await response.body?.cancel().catch(() => undefined);
  }
  return [401, 403, 404, 410].includes(response.status) ? GOOGLE_RECONNECT : GOOGLE_UNAVAILABLE;
}

export async function listGoogleWorkAgendaEvents(
  accessToken: string,
  calendarId: string,
  window: CalendarReadWindow,
  options: { fetch?: typeof fetch } = {}
): Promise<{ events: BriefEvent[]; truncated: boolean }> {
  const transport = options.fetch ?? fetch;
  // One deadline for the whole read, including every page and its response body.
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const events = new Map<string, BriefEvent>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    if (!calendarId || calendarId === "." || calendarId === ".." || calendarId.length > 1024) throw new Error(GOOGLE_RECONNECT);
    const endpoint = new URL(GOOGLE_CALENDAR_ENDPOINT + encodeURIComponent(calendarId) + "/events");
    endpoint.searchParams.set("singleEvents", "true");
    endpoint.searchParams.set("showDeleted", "false");
    endpoint.searchParams.set("orderBy", "startTime");
    endpoint.searchParams.set("timeMin", window.start);
    endpoint.searchParams.set("timeMax", window.end);
    endpoint.searchParams.set("timeZone", briefTimezone);
    endpoint.searchParams.set("maxResults", String(PAGE_SIZE));
    endpoint.searchParams.set("fields", GOOGLE_AGENDA_FIELDS);

    for (let page = 0; page < MAX_PAGES; page++) {
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
      const response = await transport(new URL(endpoint), {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal
      });
      if (!response.ok) throw new Error(await providerError(response));
      const result = await jsonRecord(response);
      if (!result || (result.items !== undefined && !Array.isArray(result.items))) throw new Error(GOOGLE_UNAVAILABLE);
      for (const row of result.items ?? []) {
        const event = googleEvent(row, calendarId, window);
        if (!event || events.has(event.id)) continue;
        if (events.size === MAX_EVENTS) return { events: [...events.values()], truncated: true };
        events.set(event.id, event);
      }
      if (result.nextPageToken === undefined || result.nextPageToken === "") {
        return { events: [...events.values()], truncated: false };
      }
      if (typeof result.nextPageToken !== "string" || result.nextPageToken.length > 4096) throw new Error(GOOGLE_UNAVAILABLE);
      pageToken = result.nextPageToken;
      if (seenTokens.has(pageToken)) break;
      seenTokens.add(pageToken);
    }
    return { events: [...events.values()], truncated: true };
  } catch (error) {
    throw new Error(error instanceof Error && error.message === GOOGLE_RECONNECT ? GOOGLE_RECONNECT : GOOGLE_UNAVAILABLE);
  }
}
