import { supabase } from "./supabase";

// Start of "today" in the viewer's own time zone
export const dayStartIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export async function fetchAdminDashboard() {
  const { data, error } = await supabase.rpc("admin_dashboard", { p_day_start: dayStartIso() });
  if (error) throw error;
  return data;
}

export async function fetchMyDashboard() {
  const { data, error } = await supabase.rpc("my_dashboard", { p_day_start: dayStartIso() });
  if (error) throw error;
  return data;
}

export const timeAgo = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export async function fetchSourcing() {
  const { data, error } = await supabase.rpc("sourcing_dashboard", { p_day_start: dayStartIso() });
  if (error) throw error;
  return data ?? [];
}
