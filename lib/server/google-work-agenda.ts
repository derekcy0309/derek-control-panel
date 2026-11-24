import type { SupabaseClient } from "@supabase/supabase-js";
import { GOOGLE_WORK_SOURCE, type BriefEvent, type BriefSource, type CalendarReadWindow } from "../calendar-brief.ts";
import {
  getValidGoogleAccessToken,
  GoogleCalendarAuthorizationError,
  type GoogleConnection
} from "../integrations/google-calendar.ts";
import { listGoogleWorkAgendaEvents } from "../integrations/google-work-agenda.ts";

type WorkConnection = GoogleConnection & { show_work_in_agenda: boolean };
type WorkAgenda = { events: BriefEvent[]; source: BriefSource | null; truncated: boolean };
const connectionFields = "id,user_id,target,account_email,calendar_id,calendar_name,status,access_expires_at,show_work_in_agenda";
const hidden = (): WorkAgenda => ({ events: [], source: null, truncated: false });
const unavailable = (reconnect = false): WorkAgenda => ({
  events: [],
  source: {
    label: GOOGLE_WORK_SOURCE,
    state: "stale",
    lastSync: null,
    errorCode: reconnect ? "GOOGLE_RECONNECT" : "GOOGLE_UNAVAILABLE"
  },
  truncated: false
});

/** Only called by the human dashboard with a session-scoped (not service-role) client. */
export async function readDashboardGoogleWorkAgenda(
  client: SupabaseClient,
  owner: string,
  window: CalendarReadWindow,
  dependencies = { token: getValidGoogleAccessToken, list: listGoogleWorkAgendaEvents }
): Promise<WorkAgenda> {
  const readSelection = () => client.from("google_calendar_connections").select(connectionFields)
    .eq("user_id", owner).eq("target", "work").eq("show_work_in_agenda", true)
    .abortSignal(AbortSignal.timeout(2500)).maybeSingle();
  try {
    const { data, error } = await readSelection();
    if (error) return hidden();
    if (!data) return hidden();
    const selected = data as WorkConnection;
    if (selected.status === "disconnected") {
      return { ...hidden(), source: { label: GOOGLE_WORK_SOURCE, state: "not_connected", lastSync: null } };
    }
    if (!selected.calendar_id) {
      return { ...hidden(), source: { label: GOOGLE_WORK_SOURCE, state: "select_calendars", lastSync: null } };
    }
    const token = await dependencies.token(client, selected, { signal: AbortSignal.timeout(3500), persist: false });
    const result = await dependencies.list(token, selected.calendar_id, window);
    // Discard in-flight results when the user disables the source, disconnects
    // or reselects the calendar. A normal token refresh may change updated_at.
    const latest = await readSelection();
    if (latest.error) return unavailable();
    if (!latest.data || latest.data.id !== selected.id || latest.data.account_email !== selected.account_email
        || latest.data.calendar_id !== selected.calendar_id || latest.data.status === "disconnected") return hidden();
    return {
      ...result,
      source: { label: GOOGLE_WORK_SOURCE, state: "fresh", lastSync: new Date().toISOString() }
    };
  } catch (error) {
    return unavailable(error instanceof GoogleCalendarAuthorizationError
      || (error instanceof Error && error.message === "GOOGLE_RECONNECT"));
  }
}
