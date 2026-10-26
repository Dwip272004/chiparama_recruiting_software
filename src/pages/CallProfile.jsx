import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { StatusPill } from "../components/StatusSelect";
import {
  CALL_STATUSES, CHANNELS, fetchActivity, fetchCallList, logCall, callBucket, sortForCalling,
  statusMeta, fmtDateTime, initials,
} from "../lib/outreach";
import "../outreach.css";

const OUTCOMES = CALL_STATUSES.filter((s) => s.key !== "not_called");
const href = (u) => (u.startsWith("http") ? u : `https://${u}`);

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="link"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

// Full-page calling screen for one candidate, with fast navigation through the queue.
export default function CallProfile() {
  const { rowId } = useParams();
  const [sp] = useSearchParams();
  const jobParam = sp.get("job") || "";
  const navigate = useNavigate();

  const [rows, setRows] = useState(null);
  const [queue, setQueue] = useState([]); // snapshot of ids, so the order doesn't jump while calling
  const [handled, setHandled] = useState(() => new Set());
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    fetchCallList()
      .then((r) => {
        setRows(r);
        setQueue(
          r.filter((x) => callBucket(x) !== "done" && (!jobParam || x.job_id === jobParam))
            .sort(sortForCalling)
            .map((x) => x.id)
        );
      })
      .catch((e) => setError(e.message));
    // load once; the snapshot is intentionally stable during a calling session
    // eslint-disable-next-line
  }, []);

  const row = rows?.find((r) => r.id === rowId);
  const pos = queue.indexOf(rowId);
  const go = useCallback((id) => navigate(`/calling/${id}${jobParam ? `?job=${jobParam}` : ""}`), [navigate, jobParam]);

  const nextId = useMemo(() => {
    if (!rows) return null;
    const start = pos >= 0 ? pos + 1 : 0;
    for (let i = start; i < queue.length; i++) {
      const r = rows.find((x) => x.id === queue[i]);
      if (r && !handled.has(r.id) && callBucket(r) !== "done") return r.id;
    }
    return null;
  }, [rows, queue, pos, handled]);
  const prevId = pos > 0 ? queue[pos - 1] : null;

  const onSaved = (updated) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setHandled((h) => new Set(h).add(updated.id));
  };

  if (error) return <div className="msg error">{error}</div>;
  if (!rows) return <div className="empty">Loading…</div>;
  if (finished)
    return (
      <div className="empty">
        <h2>🎉 You're all caught up</h2>
        <p className="muted">No more candidates in this queue right now.</p>
        <Link className="primary linkbtn" to="/calling">Back to calling list</Link>
      </div>
    );
  if (!row)
    return (
      <div className="empty">
        This candidate isn't in your list. <Link to="/calling">Back to calling list</Link>
      </div>
    );

  return (
    <Profile
      key={row.id}
      row={row}
      pos={pos}
      total={queue.length}
      upNext={queue.slice(Math.max(pos, -1) + 1).map((id) => rows.find((r) => r.id === id)).filter((r) => r && !handled.has(r.id) && callBucket(r) !== "done").slice(0, 4)}
      onSaved={onSaved}
      onGo={go}
      nextId={nextId}
      prevId={prevId}
      onFinish={() => setFinished(true)}
    />
  );
}

function Profile({ row, pos, total, upNext, onSaved, onGo, nextId, prevId, onFinish }) {
  const c = row.candidate;
  const job = row.job ?? {};
  const [status, setStatus] = useState(row.call_status === "not_called" ? "" : row.call_status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState([]);
  const noteRef = useRef(null);

  useEffect(() => {
    fetchActivity(row.id).then(setActivity).catch(() => {});
  }, [row.id, row.updated_at]);

  const save = useCallback(
    async (andNext) => {
      if (busy) return;
      setError("");
      if (!status) return setError("Pick the call outcome first.");
      setBusy(true);
      try {
        const updated = await logCall(row.id, status, note);
        onSaved(updated);
        setNote("");
        if (andNext) (nextId ? onGo(nextId) : onFinish());
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, status, note, row.id, onSaved, nextId, onGo, onFinish]
  );

  // Keyboard: 1-8 pick an outcome, Ctrl/Cmd+Enter = save & next
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(true); return; }
      const t = e.target.tagName;
      if (t === "TEXTAREA" || t === "INPUT" || t === "SELECT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= OUTCOMES.length) { setStatus(OUTCOMES[n - 1].key); noteRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const phones = [c.phone, c.phone_2, c.phone_3].filter(Boolean);
  const chips = [
    c.location,
    c.experience_years != null ? `${c.experience_years} yrs experience` : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="call-top">
        <Link to="/calling" className="crumbs-link">← Calling list</Link>
        <div className="call-nav">
          <span className="muted">{pos >= 0 ? `Candidate ${pos + 1} of ${total}` : "Outside current queue"}</span>
          <button className="ghost" disabled={!prevId} onClick={() => onGo(prevId)}>← Previous</button>
          <button className="ghost" disabled={!nextId} onClick={() => onGo(nextId)}>Skip →</button>
        </div>
      </div>

      <div className="profile-grid">
        <div className="stack">
          <section className="card profile-head">
            <div className="avatar">{initials(c.full_name)}</div>
            <div className="ph-main">
              <h1>{c.full_name}</h1>
              <div className="muted">{[c.current_title, c.current_company].filter(Boolean).join(" at ") || "No current role on file"}</div>
              <div className="tags">
                {chips.map((t) => (<span key={t} className="tag">{t}</span>))}
                {c.open_to_work === true && <span className="tag good">Open to work</span>}
                {c.open_to_work === false && <span className="tag">Not open to work</span>}
                {row.batch?.tag && <span className="tag">Lot: {row.batch.tag}</span>}
              </div>
            </div>
            <div className="ph-status">
              <StatusPill channel="call" value={row.call_status} />
              <div className="muted small">Attempts: <b>{row.call_attempts}</b></div>
              <div className="muted small">Last called: {row.last_called_at ? fmtDateTime(row.last_called_at) : "never"}</div>
            </div>
          </section>

          <section className="card">
            <h3>Contact</h3>
            {phones.length === 0 && <div className="muted">No phone number on file.</div>}
            {phones.map((p, i) => (
              <div className="contact-row" key={p}>
                <span className="muted small">Phone {i + 1}</span>
                <span className="mono big">{p}</span>
                <a className="callbtn" href={`tel:${p.replace(/[^\d+]/g, "")}`}>📞 Call</a>
                <CopyBtn text={p} />
              </div>
            ))}
            {[["Email (work)", c.email], ["Email (personal)", c.alt_email]].filter(([, v]) => v).map(([l, v]) => (
              <div className="contact-row" key={l}>
                <span className="muted small">{l}</span>
                <a href={`mailto:${v}`}>{v}</a>
                <span />
                <CopyBtn text={v} />
              </div>
            ))}
            <div className="contact-links">
              {c.linkedin_url && <a href={href(c.linkedin_url)} target="_blank" rel="noreferrer">LinkedIn profile ↗</a>}
              {c.recruiter_profile_url && <a href={c.recruiter_profile_url} target="_blank" rel="noreferrer">Recruiter profile ↗</a>}
            </div>
            <div className="chips-row">
              <span className="muted small">Other outreach:</span>
              {CHANNELS.filter((ch) => ch.key !== "call").map((ch) => (
                <span key={ch.key} className="inline-pill">{ch.label}: {statusMeta(ch.key, row[ch.col])?.label}</span>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>Role you're calling about</h3>
            <div className="role-title">
              <span className="mono">{job.job_code}</span> {job.title}
              {job.client_name && <span className="muted"> · {job.client_name}</span>}
            </div>
            <dl className="kv">
              {[["Location", job.location], ["Work mode", job.work_mode], ["Employment type", job.employment_type],
                ["Experience wanted", job.experience], ["Compensation", job.compensation], ["Openings", job.openings]]
                .filter(([, v]) => v)
                .map(([l, v]) => (<div key={l}><dt>{l}</dt><dd>{v}</dd></div>))}
            </dl>
            {job.skills?.length > 0 && (
              <div className="tags">{job.skills.map((s) => (<span key={s} className="tag">{s}</span>))}</div>
            )}
            {[["Summary", job.summary, true], ["Responsibilities", job.responsibilities, false], ["Requirements", job.requirements, true]]
              .filter(([, v]) => v)
              .map(([l, v, o]) => (
                <details key={l} open={o}>
                  <summary>{l}</summary>
                  <p className="pre">{v}</p>
                </details>
              ))}
          </section>

          {(c.notes || row.call_notes) && (
            <section className="card">
              <h3>Notes on file</h3>
              {c.notes && <p className="pre"><span className="muted small">Candidate notes: </span>{c.notes}</p>}
              {row.call_notes && <p className="pre"><span className="muted small">Latest call note: </span>{row.call_notes}</p>}
            </section>
          )}

          <section className="card">
            <h3>History</h3>
            {activity.length === 0 ? (
              <div className="hint">No calls or changes yet.</div>
            ) : (
              <ul className="timeline">
                {activity.map((a) => (
                  <li key={a.id}>
                    <div>
                      {a.channel === "assignment" ? "Assigned for calling" : (
                        <><span className="muted small">{a.channel === "call" ? "Call" : a.channel}: </span>
                          <StatusPill channel={a.channel} value={a.to_status} /></>
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

        <aside className="call-actions">
          <section className="card">
            <h3>How did the call go?</h3>
            <div className="outcomes">
              {OUTCOMES.map((s, i) => (
                <button
                  type="button"
                  key={s.key}
                  className={`outcome status-${s.color} ${status === s.key ? "picked" : ""}`}
                  onClick={() => { setStatus(s.key); noteRef.current?.focus(); }}
                >
                  <kbd>{i + 1}</kbd> {s.label}
                </button>
              ))}
            </div>
            <label>
              Notes
              <textarea
                ref={noteRef}
                rows={6}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Current CTC, expected CTC, notice period, location preference, availability…"
              />
            </label>
            {error && <div className="msg error">{error}</div>}
            <button className="primary big-btn" disabled={busy} onClick={() => save(true)}>
              {busy ? "Saving…" : nextId ? "Save & next candidate →" : "Save & finish"}
            </button>
            <button className="ghost" disabled={busy} onClick={() => save(false)}>Save and stay</button>
            <div className="hint">Shortcuts: 1–8 pick an outcome · Ctrl/⌘ + Enter saves & moves on. The time of the call is recorded automatically.</div>
          </section>

          {upNext.length > 0 && (
            <section className="card">
              <h3>Up next</h3>
              <ul className="mini-list upnext">
                {upNext.map((r) => (
                  <li key={r.id} onClick={() => onGo(r.id)}>
                    <span className="cname">{r.candidate.full_name}</span>
                    <span className="muted small">{r.candidate.current_company ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
