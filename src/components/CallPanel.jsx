import { useEffect, useState } from "react";
import { StatusPill } from "./StatusSelect";
import {
  CALL_STATUSES, CHANNELS, fetchActivity, logCall, statusMeta, fmtDateTime, toLocalInput,
} from "../lib/outreach";

// The calling screen for one candidate: contact, status buttons, notes, follow-up.
export default function CallPanel({ row, onSaved, onNext, hasNext }) {
  const c = row.candidate;
  const [status, setStatus] = useState(row.call_status);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(toLocalInput(row.next_follow_up_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    fetchActivity(row.id).then(setActivity).catch(() => {});
  }, [row.id, row.updated_at]);

  const save = async (andNext) => {
    setError("");
    if (status === "not_called" && !note.trim()) return setError("Pick the call outcome first.");
    if (status === "call_back_later" && !followUp) return setError("Set a follow-up time for call back later.");
    setBusy(true);
    try {
      const updated = await logCall(row.id, status, note, followUp ? new Date(followUp).toISOString() : null);
      setNote("");
      onSaved(updated);
      if (andNext) onNext();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="contact-card">
        {c.phone ? (
          <a className="phone" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>📞 {c.phone}</a>
        ) : (
          <span className="muted">No phone number</span>
        )}
        <div className="contact-links">
          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
          {c.linkedin_url && (
            <a href={c.linkedin_url.startsWith("http") ? c.linkedin_url : `https://${c.linkedin_url}`} target="_blank" rel="noreferrer">
              LinkedIn profile ↗
            </a>
          )}
        </div>
        <div className="muted small">
          {[c.current_title, c.current_company, c.location].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="meta">
        <span>For job: <b>{row.job?.job_code}</b> {row.job?.title}{row.job?.client_name ? ` (${row.job.client_name})` : ""}</span>
        <span>Attempts: <b>{row.call_attempts}</b> · Last called: {fmtDateTime(row.last_called_at)}</span>
        <span>
          Other channels:{" "}
          {CHANNELS.filter((ch) => ch.key !== "call").map((ch) => (
            <span key={ch.key} className="inline-pill">{ch.label}: {statusMeta(ch.key, row[ch.col])?.label}</span>
          ))}
        </span>
      </div>

      <section>
        <h4>Call outcome</h4>
        <div className="outcomes">
          {CALL_STATUSES.map((s) => (
            <button
              type="button"
              key={s.key}
              className={`outcome status-${s.color} ${status === s.key ? "picked" : ""}`}
              onClick={() => setStatus(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <label>
        Notes
        <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Current CTC, notice period, expected pay, availability, anything useful…" />
      </label>
      <label>
        Follow-up <span className="hint">(optional)</span>
        <input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      </label>

      {row.call_notes && <div className="callbox"><div className="hint">Latest saved note</div><div className="pre">{row.call_notes}</div></div>}
      {error && <div className="msg error">{error}</div>}
      <div className="row-end gap">
        <button className="ghost" disabled={busy} onClick={() => save(false)}>Save</button>
        {hasNext && <button className="primary" disabled={busy} onClick={() => save(true)}>Save & next</button>}
      </div>

      <section>
        <h4>History</h4>
        {activity.length === 0 ? (
          <div className="hint">No activity yet.</div>
        ) : (
          <ul className="timeline">
            {activity.map((a) => (
              <li key={a.id}>
                <div>
                  {a.channel === "assignment" ? "Assigned for calling" : (
                    <><StatusPill channel={a.channel} value={a.to_status} />{" "}
                      <span className="hint">from {statusMeta(a.channel, a.from_status)?.label ?? a.from_status}</span></>
                  )}
                </div>
                {a.note && <div className="pre note">{a.note}</div>}
                <div className="hint">{a.actor_name ?? "System"} · {fmtDateTime(a.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
