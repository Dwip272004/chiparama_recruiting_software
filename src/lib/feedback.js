import { supabase } from "./supabase";

export const CATEGORIES = [
  { key: "idea", label: "Idea", color: "blue" },
  { key: "bug", label: "Something's broken", color: "red" },
  { key: "question", label: "Question", color: "amber" },
  { key: "praise", label: "Works great", color: "green" },
];
export const AREAS = ["Dashboard", "Jobs", "Calling", "InMails", "Notifications", "Login / account", "Other"];
export const FB_STATUSES = [
  { key: "new", label: "New", color: "amber" },
  { key: "in_progress", label: "In progress", color: "blue" },
  { key: "done", label: "Done", color: "green" },
  { key: "wont_do", label: "Won't do", color: "gray" },
];
export const fbMeta = (list, key) => list.find((x) => x.key === key);

export async function fetchFeedback() {
  const { data, error } = await supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  return data ?? [];
}
export async function submitFeedback({ category, area, message }) {
  const { error } = await supabase.from("feedback").insert({ category, area: area || null, message });
  if (error) throw error;
}
export async function updateFeedback(id, patch) {
  const { error } = await supabase.from("feedback").update(patch).eq("id", id);
  if (error) throw error;
}
export async function fetchNewFeedbackCount() {
  const { data, error } = await supabase.rpc("feedback_new_count");
  if (error) throw error;
  return data ?? 0;
}

export async function fetchJobNotes(jobId) {
  const { data, error } = await supabase.from("job_notes").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function addJobNote(jobId, body) {
  const { error } = await supabase.from("job_notes").insert({ job_id: jobId, body });
  if (error) throw error;
}
export async function deleteJobNote(id) {
  const { error } = await supabase.from("job_notes").delete().eq("id", id);
  if (error) throw error;
}
