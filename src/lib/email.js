import { supabase } from "./supabase";

export const MERGE_FIELDS = [
  ["first_name", "First name"],
  ["full_name", "Full name"],
  ["title", "Their title"],
  ["company", "Their company"],
  ["job_title", "Job title"],
  ["client", "Client"],
  ["location", "Location"],
];
export const DEFAULT_BODY =
  "Hi {{first_name}},\n\nI came across your profile and think you could be a strong fit for a {{job_title}} role with our client {{client}} ({{location}}).\n\nWould you be open to a quick chat this week? If yes, reply here with a good time and number.\n\nBest regards,\nDwip\nChiparama\n\nNot interested? Just reply \"stop\" and I won't contact you again.";

export async function callOutlook(body) {
  const { data, error } = await supabase.functions.invoke("outlook", { body });
  if (error) {
    let msg = error.message, reconnect = false;
    try { const b = await error.context.json(); msg = b.error || msg; reconnect = !!b.reconnect; } catch { /* keep default */ }
    throw Object.assign(new Error(msg), { reconnect });
  }
  return data;
}
export const mailStatus = () => callOutlook({ action: "status" });
export const startConnect = () => callOutlook({ action: "start", return_to: `${window.location.origin}/email` });
export const sendTest = (account_id, subject, body) => callOutlook({ action: "test", account_id, subject, body });
export const sendNext = (campaign_id, lot_no) => callOutlook({ action: "send_next", campaign_id, lot_no });

export async function fetchAccounts() {
  const { data, error } = await supabase.from("mail_accounts").select("id,email,display_name,status,connected_at").order("connected_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function disconnectAccount(id) {
  const { error } = await supabase.rpc("disconnect_mail_account", { p_account_id: id });
  if (error) throw error;
}
export async function fetchBatches(jobId) {
  const { data, error } = await supabase.from("candidate_batches").select("id,tag,created_at").eq("job_id", jobId).order("created_at");
  if (error) throw error;
  return data ?? [];
}
export async function lotPreview(jobId, batchId) {
  const { data, error } = await supabase.rpc("email_lot_preview", { p_job_id: jobId, p_batch_id: batchId || null });
  if (error) throw error;
  return data;
}
export async function createCampaign(args) {
  const { data, error } = await supabase.rpc("create_email_campaign", {
    p_job_id: args.jobId, p_batch_id: args.batchId || null, p_account_id: args.accountId,
    p_name: args.name, p_subject: args.subject, p_body: args.body, p_lot_size: 20,
  });
  if (error) throw error;
  return data;
}
export async function cancelCampaign(id) {
  const { error } = await supabase.rpc("cancel_email_campaign", { p_campaign_id: id });
  if (error) throw error;
}
export async function fetchCampaigns() {
  const { data: camps, error } = await supabase
    .from("email_campaigns")
    .select("id,name,subject,status,lot_size,created_at,job:jobs(job_code,title),batch:candidate_batches(tag),account:mail_accounts(email)")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  if (!camps.length) return [];
  const ids = camps.map((c) => c.id);
  let sends = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await supabase.from("email_sends").select("campaign_id,lot_no,status,sent_at,error,to_email").in("campaign_id", ids).range(from, from + 999);
    if (e2) throw e2;
    sends = sends.concat(data);
    if (data.length < 1000) break;
  }
  return camps.map((c) => {
    const mine = sends.filter((s) => s.campaign_id === c.id);
    const lots = new Map();
    mine.forEach((s) => {
      const l = lots.get(s.lot_no) ?? { lot_no: s.lot_no, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, total: 0, errors: [] };
      l[s.status]++; l.total++;
      if (s.status === "failed" && s.error) l.errors.push(`${s.to_email}: ${s.error}`);
      lots.set(s.lot_no, l);
    });
    const tot = { queued: 0, sent: 0, failed: 0, skipped: 0, total: mine.length };
    mine.forEach((s) => { if (s.status in tot) tot[s.status]++; if (s.status === "sending") tot.queued++; });
    return { ...c, lots: [...lots.values()].sort((a, b) => a.lot_no - b.lot_no), tot, sends: mine };
  });
}

// Same merge logic as the server, for the live preview
export function render(text, v) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in v ? v[k] : ""));
}
export const SAMPLE = { first_name: "Alex", full_name: "Alex Sample", title: "Test Engineer", company: "Sample Corp", job_title: "", client: "", location: "" };
