import { useState } from "react";
import StatusBadge from "./StatusBadge";

const FIELDS = [
  ["client_name", "Client"],
  ["location", "Location"],
  ["work_mode", "Work mode (Onsite / Hybrid / Remote)"],
  ["employment_type", "Employment type (Full-time / Contract)"],
  ["experience", "Experience"],
  ["compensation", "Salary / compensation"],
  ["pay_rate", "Pay rate (e.g. $70/hr)"],
  ["bill_rate", "Bill rate (e.g. $90/hr)"],
];
const TEXTAREAS = [
  ["summary", "Summary"],
  ["responsibilities", "Responsibilities"],
  ["requirements", "Requirements"],
];

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

export default function JobDetail({ job, statuses, canEdit, onSave }) {
  const [form, setForm] = useState(() => ({
    job_code: job.job_code,
    title: job.title ?? "",
    status: job.status,
    openings: job.openings ?? 1,
    skills: (job.skills ?? []).join(", "),
    ...Object.fromEntries([...FIELDS, ...TEXTAREAS].map(([k]) => [k, job[k] ?? ""])),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showRaw, setShowRaw] = useState(job.status === "pending_review");

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setSaved(false);
  };
  const pending = job.status === "pending_review";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.job_code.trim()) return setError("Job ID is required.");
    if (form.status !== "pending_review" && !form.title.trim())
      return setError("Add a job title before moving the job out of Pending Review.");
    setBusy(true);
    try {
      const patch = {
        job_code: form.job_code.trim(),
        title: form.title.trim() || null,
        status: form.status,
        openings: form.openings ? Number(form.openings) : null,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
      };
      [...FIELDS, ...TEXTAREAS].forEach(([k]) => (patch[k] = form[k].trim() || null));
      await onSave(patch);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const meta = (
    <div className="meta">
      <span>Submitted by <b>{job.submitted_by_name ?? "—"}</b> · {fmt(job.created_at)}</span>
      {job.reviewed_at && (
        <span>Reviewed by <b>{job.reviewed_by_name ?? "—"}</b> · {fmt(job.reviewed_at)}</span>
      )}
      {job.intake_note && <span>Note: {job.intake_note}</span>}
    </div>
  );

  const rawBlock = (
    <div className="raw">
      <button type="button" className="link" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? "Hide" : "Show"} original JD
      </button>
      {showRaw && <pre>{job.raw_jd}</pre>}
    </div>
  );

  if (!canEdit) {
    return (
      <div className="stack">
        <div className="detail-top">
          <StatusBadge statusKey={job.status} statuses={statuses} />
        </div>
        {meta}
        {pending ? (
          <div className="msg info">Awaiting admin review. The structured job details will appear here.</div>
        ) : (
          <dl className="kv">
            {[["Job ID", job.job_code], ...FIELDS.map(([k, l]) => [l.split(" (")[0], job[k]]),
              ["Openings", job.openings], ["Skills", (job.skills ?? []).join(", ")]]
              .filter(([, v]) => v)
              .map(([l, v]) => (<div key={l}><dt>{l}</dt><dd>{v}</dd></div>))}
          </dl>
        )}
        {!pending &&
          TEXTAREAS.filter(([k]) => job[k]).map(([k, l]) => (
            <section key={k}><h4>{l}</h4><p className="pre">{job[k]}</p></section>
          ))}
        {rawBlock}
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {pending && (
        <div className="msg info">
          New JD. Fill in the structured details, then change the status (for example to Open) to publish it.
        </div>
      )}
      {meta}
      {rawBlock}

      <div className="two-col">
        <label>Job ID<input value={form.job_code} onChange={set("job_code")} /></label>
        <label>
          Status
          <select value={form.status} onChange={set("status")}>
            {statuses
              .filter((s) => s.is_active || s.key === job.status)
              .map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
          </select>
        </label>
      </div>
      <label>Job title<input value={form.title} onChange={set("title")} placeholder="e.g. Senior DFT Engineer" /></label>

      <div className="two-col">
        {FIELDS.map(([k, l]) => (
          <label key={k}>{l}<input value={form[k]} onChange={set(k)} /></label>
        ))}
        <label>Openings<input type="number" min="1" value={form.openings} onChange={set("openings")} /></label>
      </div>
      <label>
        Skills <span className="hint">(comma separated)</span>
        <input value={form.skills} onChange={set("skills")} placeholder="DFT, Scan, ATPG, Synopsys" />
      </label>
      {TEXTAREAS.map(([k, l]) => (
        <label key={k}>{l}<textarea rows={k === "summary" ? 3 : 6} value={form[k]} onChange={set(k)} /></label>
      ))}

      {error && <div className="msg error">{error}</div>}
      {saved && <div className="msg ok">Saved.</div>}
      <div className="row-end sticky-actions">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
