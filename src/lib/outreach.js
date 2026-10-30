import { supabase } from "./supabase";

/* ---------- Channels & statuses ---------- */

export const CHANNELS = [
  { key: "rcs", col: "rcs_status", label: "RCS" },
  { key: "email", col: "email_status", label: "Email" },
  { key: "linkedin", col: "linkedin_status", label: "LinkedIn" },
  { key: "call", col: "call_status", label: "Calling" },
];

export const MSG_STATUSES = [
  { key: "not_started", label: "Not started", color: "gray" },
  { key: "queued", label: "Queued", color: "amber" },
  { key: "sent", label: "Sent", color: "blue" },
  { key: "delivered", label: "Delivered", color: "purple" },
  { key: "replied", label: "Replied", color: "green" },
  { key: "interested", label: "Interested", color: "green" },
  { key: "not_interested", label: "Not interested", color: "orange" },
  { key: "failed", label: "Failed / bounced", color: "red" },
  { key: "opted_out", label: "Opted out", color: "red" },
];

export const CALL_STATUSES = [
  { key: "not_called", label: "Not called", color: "gray" },
  { key: "no_answer", label: "No answer", color: "orange" },
  { key: "voicemail", label: "Voicemail", color: "amber" },
  { key: "busy", label: "Busy", color: "amber" },
  { key: "call_back_later", label: "Call back later", color: "blue" },
  { key: "connected_interested", label: "Connected: interested", color: "green" },
  { key: "connected_not_interested", label: "Connected: not interested", color: "gray" },
  { key: "wrong_number", label: "Wrong number", color: "red" },
  { key: "do_not_call", label: "Do not call", color: "red" },
];

export const statusOptions = (channel) => (channel === "call" ? CALL_STATUSES : MSG_STATUSES);
export const statusMeta = (channel, key) => statusOptions(channel).find((s) => s.key === key);
export const channelByKey = (key) => CHANNELS.find((c) => c.key === key);

// Calling queue buckets
export const RETRY = ["no_answer", "voicemail", "busy"];
export function callBucket(row) {
  const s = row.call_status;
  if (s === "not_called") return "new";
  if (s === "call_back_later") return "callback";
  if (RETRY.includes(s)) return "retry";
  return "done";
}

// Calling order: callbacks first, then never-called, then retries (longest since last attempt first)
export const BUCKET_ORDER = { callback: 0, new: 1, retry: 2, done: 3 };
export function sortForCalling(a, b) {
  const d = BUCKET_ORDER[callBucket(a)] - BUCKET_ORDER[callBucket(b)];
  if (d) return d;
  const ta = a.last_called_at ? new Date(a.last_called_at).getTime() : 0;
  const tb = b.last_called_at ? new Date(b.last_called_at).getTime() : 0;
  return ta - tb;
}

export const initials = (name = "") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/* ---------- Data access ---------- */

const JC_SELECT = "*, candidate:candidates(*), batch:candidate_batches(id,tag)";
const CALL_SELECT =
  "*, candidate:candidates(*), batch:candidate_batches(id,tag), " +
  "job:jobs(job_code,title,client_name,location,work_mode,employment_type,experience,compensation,openings,skills,summary,responsibilities,requirements)";

async function fetchAll(build) {
  const size = 1000;
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

export async function fetchJobByCode(code) {
  const { data, error } = await supabase.from("jobs").select("*").eq("job_code", code).maybeSingle();
  if (error) throw error;
  return data;
}

export const fetchBatches = async (jobId) => {
  const { data, error } = await supabase
    .from("candidate_batches")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchJobCandidates = (jobId) =>
  fetchAll(() =>
    supabase
      .from("job_candidates")
      .select(JC_SELECT)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .order("id")
  );

export const fetchCallList = () =>
  fetchAll(() =>
    supabase
      .from("job_candidates")
      .select(CALL_SELECT)
      .not("call_assigned_to", "is", null)
      .order("created_at", { ascending: false })
      .order("id")
  );

export async function fetchCallers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("role", "recruiting_manager")
    .order("full_name");
  if (error) throw error;
  return data;
}

export async function fetchActivity(jobCandidateId) {
  const { data, error } = await supabase
    .from("candidate_activity")
    .select("*")
    .eq("job_candidate_id", jobCandidateId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function updateJobCandidate(id, patch) {
  const { data, error } = await supabase
    .from("job_candidates")
    .update(patch)
    .eq("id", id)
    .select(JC_SELECT)
    .single();
  if (error) throw error;
  return data;
}

// Apply a patch to explicit ids (chunked) or to a whole lot
export async function bulkUpdateIds(ids, patch) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("job_candidates").update(patch).in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}
export async function bulkUpdateBatch(batchId, patch) {
  const { error } = await supabase.from("job_candidates").update(patch).eq("batch_id", batchId);
  if (error) throw error;
}

export async function removeFromJob(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("job_candidates").delete().in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function updateCandidate(id, patch) {
  const { error } = await supabase.from("candidates").update(patch).eq("id", id);
  if (error) {
    if (error.code === "23505") throw new Error("Another candidate already has that email or LinkedIn URL.");
    throw error;
  }
}

export async function createBatch(jobId, tag, source) {
  const { data, error } = await supabase.rpc("create_candidate_batch", {
    p_job_id: jobId,
    p_tag: tag,
    p_source: source || null,
  });
  if (error) throw error;
  return data;
}

export async function addToBatch(batchId, rows) {
  const total = { added: 0, already_on_job: 0, new_people: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.rpc("add_candidates_to_batch", {
      p_batch_id: batchId,
      p_rows: rows.slice(i, i + 500),
    });
    if (error) throw error;
    Object.keys(total).forEach((k) => (total[k] += data[k] ?? 0));
  }
  return total;
}

export async function logCall(id, status, note) {
  const { error } = await supabase.rpc("log_call", {
    p_id: id,
    p_status: status,
    p_note: note || null,
  });
  if (error) throw error;
  const { data, error: e2 } = await supabase
    .from("job_candidates")
    .select(CALL_SELECT)
    .eq("id", id)
    .single();
  if (e2) throw e2;
  return data;
}

/* ---------- CSV / pasted table parsing ---------- */

export function parseDelimited(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = first.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let inQ = false;
  const pushRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else cell += c;
  }
  if (cell !== "" || row.length) pushRow();
  return rows;
}

const ALIASES = {
  full_name: ["name", "full name", "full_name", "candidate", "candidate name"],
  first_name: ["first name", "first_name", "firstname"],
  last_name: ["last name", "last_name", "lastname", "surname"],
  email: ["work email", "email", "email address", "e-mail", "mail"],
  alt_email: ["personal email", "alternate email", "alt email", "email 2", "other email"],
  phone: ["direct phone 1", "direct phone", "phone 1", "phone", "mobile", "phone number", "contact", "contact number", "mobile number", "cell"],
  phone_2: ["phone 2", "direct phone 2", "alternate phone", "mobile 2"],
  phone_3: ["phone 3", "direct phone 3", "mobile 3"],
  recruiter_profile_url: ["recruiter profile", "recruiter profile url", "linkedin recruiter", "recruiter link"],
  open_to_work: ["open to work", "open_to_work", "opentowork"],
  experience_years: ["experience years", "experience", "years of experience", "yoe", "total experience"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin_url", "profile", "profile url", "linkedin profile", "linkedin link"],
  current_title: ["title", "current title", "designation", "job title", "position", "headline"],
  current_company: ["company", "current company", "employer", "organization", "organisation"],
  location: ["location", "city", "current location", "region"],
};

const digits = (s) => (s ?? "").replace(/\D/g, "");
const liKey = (s) =>
  (s ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

export function mapTable(table) {
  if (table.length < 2) return { rows: [], valid: [], invalid: [], dupes: 0, recognised: [], ignored: [] };
  const header = table[0].map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
  const idx = {};
  const recognised = [];
  Object.entries(ALIASES).forEach(([field, names]) => {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) { idx[field] = i; recognised.push(header[i]); }
  });
  const ignored = table[0].filter((_, i) => !Object.values(idx).includes(i));

  const valid = [];
  const invalid = [];
  const seen = new Set();
  let dupes = 0;
  table.slice(1).forEach((cells, n) => {
    const get = (f) => (idx[f] !== undefined ? (cells[idx[f]] ?? "").trim() : "");
    const r = {
      full_name: get("full_name") || [get("first_name"), get("last_name")].filter(Boolean).join(" "),
      email: get("email").toLowerCase(),
      alt_email: get("alt_email").toLowerCase(),
      phone: get("phone"),
      phone_2: get("phone_2"),
      phone_3: get("phone_3"),
      linkedin_url: get("linkedin_url"),
      recruiter_profile_url: get("recruiter_profile_url"),
      current_title: get("current_title"),
      current_company: get("current_company"),
      location: get("location"),
      open_to_work: get("open_to_work"),
      experience_years: get("experience_years"),
    };
    // If only a personal email is given, use it as the main email
    if (!r.email && r.alt_email) { r.email = r.alt_email; r.alt_email = ""; }
    // Fill empty phone slots in order so "phone 1" can be blank
    const phones = [r.phone, r.phone_2, r.phone_3].filter(Boolean);
    [r.phone, r.phone_2, r.phone_3] = [phones[0] ?? "", phones[1] ?? "", phones[2] ?? ""];
    const line = n + 2;
    if (!r.full_name) return invalid.push({ line, reason: "No name" });
    if (!r.email && !r.linkedin_url && !r.recruiter_profile_url && digits(r.phone).length < 7)
      return invalid.push({ line, name: r.full_name, reason: "No phone, email or profile link" });
    const keys = [r.email && `e:${r.email}`, r.alt_email && `e:${r.alt_email}`,
      r.linkedin_url && `l:${liKey(r.linkedin_url)}`,
      r.recruiter_profile_url && `r:${r.recruiter_profile_url.toLowerCase()}`,
      digits(r.phone).length >= 7 && `p:${digits(r.phone)}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) { dupes++; return; }
    keys.forEach((k) => seen.add(k));
    valid.push(r);
  });
  return { valid, invalid, dupes, recognised, ignored };
}

export const TEMPLATE_HEADERS = [
  "name", "current title", "company", "location", "open to work", "experience years",
  "Direct phone 1", "phone 2", "phone 3", "work email", "personal email", "recruiter profile",
];
export function downloadTemplate() {
  const sample = ["Asha Rao", "Senior DFT Engineer", "Broadcom", "Bangalore", "Yes", "8",
    "+919876543210", "", "", "asha.rao@company.com", "asha.rao@gmail.com", "https://www.linkedin.com/talent/profile/…"];
  const csv = [TEMPLATE_HEADERS, sample].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "outreach-list-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

export async function deleteLot(batchId, mode) {
  const { data, error } = await supabase.rpc("delete_candidate_lot", { p_batch_id: batchId, p_mode: mode });
  if (error) throw error;
  return data;
}
