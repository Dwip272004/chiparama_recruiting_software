import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import Drawer from "../components/Drawer";
import CallPanel from "../components/CallPanel";
import { StatusPill } from "../components/StatusSelect";
import { fetchCallList, fetchCallers, callBucket, fmtDateTime } from "../lib/outreach";
import "../outreach.css";

const VIEWS = [
  ["queue", "To call"],
  ["followup", "Follow-ups due"],
  ["done", "Done"],
  ["all", "All"],
];
const ORDER = { followup: 0, new: 1, retry: 2, done: 3 };

export default function CallingList() {
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "super_admin";
  const [rows, setRows] = useState([]);
  const [callers, setCallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("queue");
  const [jobFilter, setJobFilter] = useState("");
  const [callerFilter, setCallerFilter] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    try {
      const [r, c] = await Promise.all([fetchCallList(), isAdmin ? fetchCallers() : Promise.resolve([])]);
      setRows(r);
      setCallers(c);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const jobs = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => r.job && m.set(r.job_id, r.job));
    return [...m.entries()];
  }, [rows]);

  const stats = useMemo(() => {
    const s = { total: rows.length, new: 0, followup: 0, retry: 0, done: 0, interested: 0 };
    rows.forEach((r) => {
      s[callBucket(r)]++;
      if (r.call_status === "connected_interested") s.interested++;
    });
    return s;
  }, [rows]);

  const callerName = (id) => callers.find((c) => c.id === id)?.full_name ?? "—";

  const visible = useMemo(() => {
    return rows
      .filter((r) => {
        const b = callBucket(r);
        if (view === "queue" && b === "done") return false;
        if (view === "followup" && b !== "followup") return false;
        if (view === "done" && b !== "done") return false;
        if (jobFilter && r.job_id !== jobFilter) return false;
        if (callerFilter && r.call_assigned_to !== callerFilter) return false;
        if (!q.trim()) return true;
        const c = r.candidate;
        return `${c.full_name} ${c.phone ?? ""} ${c.current_company ?? ""}`.toLowerCase().includes(q.toLowerCase());
      })
      .sort((a, b) => {
        const d = ORDER[callBucket(a)] - ORDER[callBucket(b)];
        if (d) return d;
        const ta = a.last_called_at ? new Date(a.last_called_at).getTime() : 0;
        const tb = b.last_called_at ? new Date(b.last_called_at).getTime() : 0;
        return ta - tb;
      });
  }, [rows, view, jobFilter, callerFilter, q]);

  const idx = visible.findIndex((r) => r.id === openId);
  const openRow = rows.find((r) => r.id === openId);

  const onSaved = (updated) => setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  const goNext = () => {
    const next = visible[idx + 1] ?? visible[idx - 1];
    // after saving, the list re-sorts, so move to the item that followed this one
    setOpenId(next && next.id !== openId ? next.id : null);
  };

  const countFor = (k) =>
    k === "queue" ? stats.new + stats.retry + stats.followup : k === "followup" ? stats.followup : k === "done" ? stats.done : stats.total;

  return (
    <div>
      <div className="page-head">
        <h1>{isAdmin ? "Calling list (all callers)" : "My calling list"}</h1>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="stat-row">
        <div className="stat"><div className="num">{stats.new}</div><div className="lbl">Not called yet</div></div>
        <div className="stat"><div className="num">{stats.followup}</div><div className="lbl">Follow-ups due</div></div>
        <div className="stat"><div className="num">{stats.retry}</div><div className="lbl">Retry later</div></div>
        <div className="stat"><div className="num">{stats.interested}</div><div className="lbl">Interested</div></div>
        <div className="stat"><div className="num">{stats.done}</div><div className="lbl">Completed</div></div>
      </div>

      <div className="filters">
        {VIEWS.map(([k, l]) => (
          <button key={k} className={`chip ${view === k ? "on" : ""}`} onClick={() => setView(k)}>
            {l} <span>{countFor(k)}</span>
          </button>
        ))}
        <select className="mini" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
          <option value="">All jobs</option>
          {jobs.map(([id, j]) => (<option key={id} value={id}>{j.job_code} {j.title ?? ""}</option>))}
        </select>
        {isAdmin && (
          <select className="mini" value={callerFilter} onChange={(e) => setCallerFilter(e.target.value)}>
            <option value="">All callers</option>
            {callers.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
          </select>
        )}
        <input className="search" placeholder="Search name, phone, company…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {rows.length === 0
            ? "No candidates have been assigned for calling yet. The admins assign calling lots from the job's candidates page."
            : "Nothing in this view."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Candidate</th><th>Phone</th><th>Job</th><th>Status</th><th>Attempts</th><th>Follow-up</th>
                {isAdmin && <th>Caller</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const due = callBucket(r) === "followup";
                return (
                  <tr key={r.id} className={openId === r.id ? "sel" : ""} onClick={() => setOpenId(r.id)}>
                    <td>
                      <div className="cname">{r.candidate.full_name}</div>
                      <div className="muted small">{[r.candidate.current_title, r.candidate.current_company].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="mono">{r.candidate.phone ?? "—"}</td>
                    <td className="small"><span className="mono">{r.job?.job_code}</span> {r.job?.title}</td>
                    <td><StatusPill channel="call" value={r.call_status} /></td>
                    <td>{r.call_attempts}</td>
                    <td className={due ? "due" : "muted"}>{r.next_follow_up_at ? fmtDateTime(r.next_follow_up_at) : "—"}</td>
                    {isAdmin && <td className="small">{callerName(r.call_assigned_to)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={!!openRow} onClose={() => setOpenId(null)} title={openRow?.candidate.full_name ?? ""} subtitle={openRow?.job?.job_code} width={560}>
        {openRow && (
          <CallPanel
            key={openRow.id}
            row={openRow}
            onSaved={onSaved}
            onNext={goNext}
            hasNext={visible.length > 1}
          />
        )}
      </Drawer>
    </div>
  );
}
