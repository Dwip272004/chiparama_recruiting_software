import { supabase } from "./supabase";

export const POS_STATUSES = [
  { key: "open", label: "Open", color: "green" },
  { key: "active", label: "Active", color: "blue" },
  { key: "pending", label: "Pending", color: "amber" },
  { key: "on_hold", label: "On hold", color: "gray" },
];
export const PRIORITIES = [
  { key: "urgent", label: "Urgent", color: "red", rank: 0 },
  { key: "high", label: "High", color: "orange", rank: 1 },
  { key: "normal", label: "Normal", color: "gray", rank: 2 },
];
export const prioMeta = (k) => PRIORITIES.find((p) => p.key === k) ?? PRIORITIES[2];
export const statusMeta = (k) => POS_STATUSES.find((s) => s.key === k) ?? POS_STATUSES[0];
export const EMPLOYMENT = ["Contract", "Full Time", "Contract / Full Time"];
export const WORK_MODES = ["Onsite", "Hybrid", "Remote", "Remote/Hybrid"];

export async function fetchPositions() {
  const { data, error } = await supabase.from("open_positions").select("*").order("added_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return data ?? [];
}
export async function fetchPositionLog(id) {
  const { data, error } = await supabase.from("open_position_log").select("*").eq("position_id", id).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function canEditPositions() {
  const { data, error } = await supabase.rpc("can_edit_positions");
  if (error) return false;
  return !!data;
}
export async function savePosition(id, p) {
  const { data, error } = await supabase.rpc("save_position", { p_id: id ?? null, p });
  if (error) throw error;
  return data;
}
export async function removePosition(id, reason) {
  const { error } = await supabase.rpc("remove_position", { p_id: id, p_reason: reason || null });
  if (error) throw error;
}
export async function restorePosition(id) {
  const { error } = await supabase.rpc("restore_position", { p_id: id });
  if (error) throw error;
}
export async function setPriority(id, priority, note) {
  const { error } = await supabase.rpc("set_position_priority", { p_id: id, p_priority: priority, p_note: note || null });
  if (error) throw error;
}
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
export const daysOpen = (p) => Math.max(0, Math.floor(((p.removed_at ? new Date(p.removed_at) : new Date()) - new Date(p.added_at)) / 86400000));
