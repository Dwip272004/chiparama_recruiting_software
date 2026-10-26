import { useMemo, useState } from "react";
import { requestInmails } from "../lib/inmail";

export function InmailBadge({ state }) {
  if (state === "requested") return <span className="status status-amber">InMail requested</span>;
  if (state === "sent") return <span className="status status-green">InMail sent</span>;
  return <span className="muted small">—</span>;
}

// rows: selected job_candidate rows (with .candidate and .job). onDone(result) after success.
export function InmailRequestModal({ rows, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byJob = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const k = r.job_id;
      if (!m.has(k)) m.set(k, { job: r.job, rows: [] });
      m.get(k).rows.push(r);
    });
    return [...m.values()];
  }, [rows]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await requestInmails(rows.map((r) => r.id), note);
      onDone(res);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-label="Request InMails">
        <div className="modal-head">
          <div>
            <h3>Request LinkedIn InMails</h3>
            <div className="muted small">InMails are paid, so the admins send them. Your request goes to Dwip.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {byJob.map(({ job, rows: rs }) => (
            <div className="req-job" key={rs[0].job_id}>
              <div className="row-between">
                <div><span className="mono">{job?.job_code}</span> <b>{job?.title}</b></div>
                <span className="muted small">{rs.length} candidate{rs.length > 1 ? "s" : ""}</span>
              </div>
              <div className="req-names">
                {rs.slice(0, 8).map((r) => (<span key={r.id} className="inline-pill">{r.candidate.full_name}</span>))}
                {rs.length > 8 && <span className="muted small">+{rs.length - 8} more</span>}
              </div>
            </div>
          ))}
          <label>
            Note for the admin
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
              placeholder="Why InMail? e.g. phone unreachable, strong profile, priority candidate, what to mention in the message…" />
          </label>
          <div className="hint">Candidates already requested or already messaged on LinkedIn are skipped automatically.</div>
          {error && <div className="msg error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : `Send request for ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
