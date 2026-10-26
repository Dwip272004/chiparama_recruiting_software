import { supabase } from "./supabase";

export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function markRead(ids = null) {
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  if (error) throw error;
}

export async function fetchActivityFeed(limit = 40) {
  const { data, error } = await supabase.rpc("activity_feed", { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}
