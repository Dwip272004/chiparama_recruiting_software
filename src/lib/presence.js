import { supabase } from "./supabase";

// Who is on the calling pages right now. Uses Supabase Realtime presence (no DB table):
// each browser tab announces itself while it is on /calling*, the admin "Online" page listens.
const TOPIC = "calling-presence";
const tabKey = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());

let channel = null;
let subscribed = false;
let me = null; // payload while tracking, else null
let currentDetail = ""; // what the user is working on, set by the call screen
const listeners = new Set();

function snapshot() {
  const byUser = new Map();
  Object.values(channel?.presenceState() ?? {}).flat().forEach((m) => {
    if (!m?.id) return;
    const cur = byUser.get(m.id);
    if (!cur) byUser.set(m.id, { ...m, tabs: 1 });
    else {
      cur.tabs++;
      if (m.since < cur.since) cur.since = m.since;
      if (m.updated > cur.updated) Object.assign(cur, { page: m.page, detail: m.detail, updated: m.updated });
    }
  });
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ensure() {
  if (channel) return;
  channel = supabase.channel(TOPIC, { config: { presence: { key: tabKey } } });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  channel.on("presence", { event: "sync" }, emit);
  channel.subscribe((status) => {
    subscribed = status === "SUBSCRIBED";
    if (subscribed && me) channel.track(me);
  });
}

// Announce this tab (call again with new page/detail to update it).
export function trackPresence(profile, { page }) {
  ensure();
  const now = Date.now();
  me = { id: profile.id, name: profile.full_name || profile.email, role: profile.role, page, detail: currentDetail, since: me?.since ?? now, updated: now };
  if (subscribed) channel.track(me);
}

// Called by the call screen, e.g. "JOB-12 · Lot 2" (no candidate names go over the channel).
export function setPresenceDetail(detail) {
  currentDetail = detail;
  if (me) {
    me = { ...me, detail, updated: Date.now() };
    if (subscribed) channel.track(me);
  }
}

export function stopTracking() {
  me = null;
  if (subscribed) channel.untrack();
}

// Admin page: get the live list; returns an unsubscribe function.
export function watchPresence(fn) {
  ensure();
  listeners.add(fn);
  if (subscribed) fn(snapshot());
  return () => listeners.delete(fn);
}

/* ---------- recorded time online (needs migration 016) ---------- */

export const sendHeartbeat = () => supabase.rpc("presence_heartbeat").then(() => {}, () => {});

export async function fetchPresenceSummary() {
  const { data, error } = await supabase.rpc("presence_summary", { p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata" });
  if (error) throw error;
  return data;
}
