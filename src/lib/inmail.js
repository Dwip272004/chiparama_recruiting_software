import { supabase } from "./supabase";

export async function requestInmails(jobCandidateIds, note) {
  const { data, error } = await supabase.rpc("request_inmails", { p_job_candidate_ids: jobCandidateIds, p_note: note || null });
  if (error) throw error;
  return data; // { requests, added, skipped }
}

export async function resolveInmailItems(itemIds, action, note) {
  const { data, error } = await supabase.rpc("resolve_inmail_items", { p_item_ids: itemIds, p_action: action, p_note: note || null });
  if (error) throw error;
  return data;
}

export async function fetchInmailRequests() {
  const { data, error } = await supabase
    .from("inmail_requests")
    .select(
      "id, note, status, requested_by, requested_by_name, handled_by_name, handled_at, created_at, " +
        "job:jobs(job_code, title, client_name), " +
        "items:inmail_request_items(id, status, sent_at, jc:job_candidates(id, call_status, call_notes, linkedin_status, " +
        "candidate:candidates(full_name, current_title, current_company, linkedin_url, recruiter_profile_url, email)))"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// job_candidate ids that currently sit in a pending request
export async function fetchPendingInmailIds() {
  const { data, error } = await supabase.from("inmail_request_items").select("job_candidate_id").eq("status", "pending").limit(5000);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.job_candidate_id));
}

export async function fetchInmailPendingCount() {
  const { data, error } = await supabase.rpc("inmail_pending_count");
  if (error) throw error;
  return data ?? 0;
}

// "none" | "requested" | "sent"
export const inmailState = (row, pendingIds) =>
  pendingIds?.has(row.id) ? "requested" : row.linkedin_status && !["not_started", "queued"].includes(row.linkedin_status) ? "sent" : "none";

export const linkHref = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `https://${u}`);
