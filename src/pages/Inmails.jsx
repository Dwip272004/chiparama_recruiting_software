import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { StatusPill } from "../components/StatusSelect";
import { fetchInmailRequests, resolveInmailItems, linkHref } from "../lib/inmail";
import { fmtDateTime } from "../lib/outreach";
import { timeAgo } from "../lib/dashboard";
import "../outreach.css";

function ItemState({ s }) {
  if (s === "sent") return <span className="status status-green">InMail sent</span>;
  if (s === "skipped") return <span className="status status-gray">Skipped</span>;
  return <span className="status status-amber">Waiting</span>;
}

function RequestCard({ req, canSend, onChanged, setError }) {
  const pending = req.items.filter((i) => i.status === "pending");
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const allSel = pending.length > 0 && pending.every((i) => sel.has(i.id));

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(pending.map((i) => i.id)));

  const act = async (action, ids) => {
    if (!ids.length) return;
    setBusy(true);
    setError("");
    try {
      await resolveInmailItems(ids, action, note);
      setSel(new Set());
      setNote("");
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLinks = async () => {
    const rows = (sel.size ? pending.filter((i) => sel.has(i.id)) : pending)
      .map((i) => linkHref(i.jc?.candidate?.recruiter_profile_url || i.jc?.candidate?.linkedin_url)).filter(Boolean);
    try { await navigator.clipboard.writeText(rows.join("\n")); } catch { /* ignore */ }
  };

  const sent = req.items.filter((i) => i.status === "sent").length;

  return (
    <section className="card req-card">
      <div className="row-between req-head">
        <div>
          <div><span className="mono">{req.job?.job_code}</span> <b>{req.job?.title}</b> {req.job?.client_name && <span className="muted">· {req.job.client_name}</span>}</div>
          <div className="muted small">
            Requested by <b>{req.requested_by_name ?? "—"}</b> · {timeAgo(req.created_at)} · {req.items.length} candidate{req.items.length > 1 ? "s" : ""}
            {req.status === "completed" && req.handled_by_name ? ` · handled by ${req.handled_by_name}` : ""}
          </div>
        </div>
        <div className="req-count">
          <span className="status status-green">{sent} sent</span>
          {pending.length > 0 && <span className="status status-amber">{pending.length} waiting</span>}
        </div>
      </div>
      {req.note && <div className="note"><span className="muted small">Note from {req.requested_by_name}:</span><br />{req.note}</div>}

      <div className="table-wrap flat">
        <table className="list cand">
          <thead>
            <tr>
              {canSend && <th style={{ width: 34 }}>{pending.length > 0 && <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" />}</th>}
              <th>Candidate</th><th>Call status &amp; notes</th><th>LinkedIn</th><th>InMail</th>
            </tr>
          </thead>
          <tbody>
            {req.items.map((i) => {
              const c = i.jc?.candidate;
              return (
                <tr key={i.id} style={{ cursor: "default" }}>
                  {canSend && <td>{i.status === "pending" && <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />}</td>}
                  <td>
                    <div className="cname">{c?.full_name ?? "—"}</div>
                    <div className="muted small">{[c?.current_title, c?.current_company].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>
                    {i.jc && <StatusPill channel="call" value={i.jc.call_status} />}
                    {i.jc?.call_notes && <div className="muted small clamp">{i.jc.call_notes}</div>}
                  </td>
                  <td className="small">
                    {c?.linkedin_url && <a href={linkHref(c.linkedin_url)} target="_blank" rel="noreferrer">Profile ↗</a>}
                    {c?.recruiter_profile_url && <> · <a href={c.recruiter_profile_url} target="_blank" rel="noreferrer">Recruiter ↗</a></>}
                    {!c?.linkedin_url && !c?.recruiter_profile_url && <span className="muted">—</span>}
                  </td>
                  <td>
                    <ItemState s={i.status} />
                    {i.sent_at && <div className="muted small">{fmtDateTime(i.sent_at)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canSend && pending.length > 0 && (
        <div className="req-actions">
          <input className="req-note" placeholder="Optional note (kept in the candidate's history)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="ghost" onClick={copyLinks}>Copy {sel.size ? "selected" : "all"} links</button>
          <button className="ghost" disabled={busy || !sel.size} onClick={() => act("skipped", [...sel])}>Skip selected</button>
          <button className="primary" disabled={busy || !sel.size} onClick={() => act("sent", [...sel])}>
            {busy ? "Saving…" : `Mark ${sel.size || ""} as InMail sent`}
          </button>
          <button className="primary" disabled={busy} onClick={() => act("sent", pending.map((i) => i.id))}>Mark all {pending.length} sent</button>
        </div>
      )}
    </section>
  );
}

export default function Inmails() {
  const { can, session } = useAuth();
  const canSend = can("inmail.send");
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("pending");
  const [mine, setMine] = useState(!canSend);

  const load = useCallback(async () => {
    try { setReqs(await fetchInmailRequests()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [load]);

  const scoped = useMemo(() => reqs.filter((r) => !mine || r.requested_by === session.user.id), [reqs, mine, session]);
  const pend = scoped.filter((r) => r.status === "pending");
  const done = scoped.filter((r) => r.status === "completed");
  const shown = tab === "pending" ? pend : tab === "done" ? done : scoped;
  const waiting = pend.reduce((n, r) => n + r.items.filter((i) => i.status === "pending").length, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>LinkedIn InMails</h1>
          <div className="muted small">
            {canSend
              ? "Requests from the calling team. Send the InMails on LinkedIn, then mark them sent so everyone can see."
              : "Request InMails from your calling list. The admins send them and mark them here."}
          </div>
        </div>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="filters">
        <button className={`chip ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>Waiting <span>{waiting}</span></button>
        <button className={`chip ${tab === "done" ? "on" : ""}`} onClick={() => setTab("done")}>Completed <span>{done.length}</span></button>
        <button className={`chip ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}>All <span>{scoped.length}</span></button>
        <label className="inline-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my requests</label>
      </div>

      {loading ? <div className="empty">Loading…</div> : shown.length === 0 ? (
        <div className="empty">{tab === "pending" ? "No InMail requests waiting." : "Nothing here yet."}</div>
      ) : (
        <div className="req-list">
          {shown.map((r) => (<RequestCard key={r.id} req={r} canSend={canSend} onChanged={load} setError={setError} />))}
        </div>
      )}
    </div>
  );
}
