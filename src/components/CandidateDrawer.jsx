import { useEffect, useState } from "react";
import StatusSelect from "./StatusSelect";
import { CHANNELS, fetchActivity, statusMeta, channelByKey, fmtDateTime } from "../lib/outreach";

const FIELDS = [
  ["full_name", "Name"],
  ["email", "Email (work)"],
  ["alt_email", "Email (personal)"],
  ["phone", "Phone 1"],
  ["phone_2", "Phone 2"],
  ["phone_3", "Phone 3"],
  ["linkedin_url", "LinkedIn URL"],
  ["recruiter_profile_url", "Recruiter profile link"],
  ["current_title", "Current title"],
  ["current_company", "Current company"],
  ["location", "Location"],
  ["experience_years", "Experience (years)"],
];

// Admin view of one candidate on one job: details, 4 channel statuses, caller, history.
export default function CandidateDrawer({ row, callers, onChannel, onAssign, onSaveCandidate, onRemove }) {
  const c = row.candidate;
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(FIELDS.map(([k]) => [k, c[k] ?? ""])),
    notes: c.notes ?? "",
    open_to_work: c.open_to_work === true ? "yes" : c.open_to_work === false ? "no" : "",
  }));
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  useEffect(() => {
    fetchActivity(row.id).then(setActivity).catch(() => {});
  }, [row.id, row.updated_at]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const callerName = (id) => callers.find((x) => x.id === id)?.full_name ?? "Unassigned";

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      const patch = Object.fromEntries(FIELDS.map(([k]) => [k, form[k].trim() || null]));
      if (!patch.full_name) throw new Error("Name is required.");
      if (patch.email) patch.email = patch.email.toLowerCase();
      if (patch.alt_email) patch.alt_email = patch.alt_email.toLowerCase();
      if (patch.experience_years !== null) {
        const n = Number(patch.experience_years);
        if (Number.isNaN(n) || n < 0 || n >= 100) throw new Error("Experience must be a number of years.");
        patch.experience_years = n;
      }
      patch.open_to_work = form.open_to_work === "yes" ? true : form.open_to_work === "no" ? false : null;
      patch.notes = form.notes.trim() || null;
      await onSaveCandidate(patch);
      setMsg({ type: "ok", text: "Saved." });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const describe = (a) => {
    if (a.channel === "assignment")
      return `Calling assigned: ${a.from_status ? callerName(a.from_status) : "Unassigned"} → ${a.to_status ? callerName(a.to_status) : "Unassigned"}`;
    const ch = channelByKey(a.channel);
    return `${ch?.label ?? a.channel}: ${statusMeta(a.channel, a.from_status)?.label ?? a.from_status} → ${statusMeta(a.channel, a.to_status)?.label ?? a.to_status}`;
  };

  return (
    <div className="stack">
      <div className="meta">
        <span>Lot: <b>{row.batch?.tag ?? "—"}</b></span>
        <span>Added {fmtDateTime(row.created_at)}</span>
      </div>

      <section>
        <h4>Outreach status</h4>
        <div className="channel-grid">
          {CHANNELS.map((ch) => (
            <label key={ch.key}>
              {ch.label}
              <StatusSelect channel={ch.key} value={row[ch.col]} onChange={(v) => onChannel(ch.col, v)} />
            </label>
          ))}
          <label>
            Calling assigned to
            <select value={row.call_assigned_to ?? ""} onChange={(e) => onAssign(e.target.value || null)}>
              <option value="">Unassigned</option>
              {callers.map((p) => (<option key={p.id} value={p.id}>{p.full_name}</option>))}
            </select>
          </label>
        </div>
        {(row.call_attempts > 0 || row.call_notes) && (
          <div className="callbox">
            <div>Call attempts: <b>{row.call_attempts}</b> · Last called: {fmtDateTime(row.last_called_at)}</div>
            {row.next_follow_up_at && <div>Follow-up: {fmtDateTime(row.next_follow_up_at)}</div>}
            {row.call_notes && <div className="pre">Latest note: {row.call_notes}</div>}
          </div>
        )}
      </section>

      <form className="stack" onSubmit={save}>
        <h4>Candidate details</h4>
        <div className="two-col">
          {FIELDS.map(([k, l]) => (
            <label key={k}>{l}<input value={form[k]} onChange={set(k)} /></label>
          ))}
          <label>
            Open to work
            <select value={form.open_to_work} onChange={set("open_to_work")}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <label>Notes<textarea rows={3} value={form.notes} onChange={set("notes")} /></label>
        {msg.text && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="row-between">
          <button type="button" className="link danger" onClick={onRemove}>Remove from this job</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
        </div>
      </form>

      <section>
        <h4>History</h4>
        {activity.length === 0 ? (
          <div className="hint">No changes yet.</div>
        ) : (
          <ul className="timeline">
            {activity.map((a) => (
              <li key={a.id}>
                <div>{describe(a)}</div>
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
