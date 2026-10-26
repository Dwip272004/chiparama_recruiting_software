import { supabase } from "./supabase";

export async function fetchStatuses() {
  const { data, error } = await supabase
    .from("job_statuses")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchJobs() {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function submitJD({ raw_jd, intake_note }) {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ raw_jd: raw_jd.trim(), intake_note: intake_note?.trim() || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateJob(id, patch) {
  const { data, error } = await supabase
    .from("jobs")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That Job ID is already used by another job.");
    throw error;
  }
  return data;
}

export async function addStatus({ key, label, color, sort_order }) {
  const { data, error } = await supabase
    .from("job_statuses")
    .insert({ key, label, color, sort_order })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateStatus(key, patch) {
  const { data, error } = await supabase
    .from("job_statuses")
    .update(patch)
    .eq("key", key)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function jobTitle(job) {
  if (job.title) return job.title;
  const first = job.raw_jd.split("\n").find((l) => l.trim());
  return `Untitled — ${first ? first.trim().slice(0, 60) : "pasted JD"}`;
}
