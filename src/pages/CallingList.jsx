import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { StatusPill } from "../components/StatusSelect";
import { fetchCallList, fetchCallers, callBucket, sortForCalling, fmtDateTime } from "../lib/outreach";
import "../outreach.css";

const VIEWS = [
  ["queue", "To call"],
  ["done", "Completed"],
  ["all", "All"],
];

export default function CallingList() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin" || role === "super_admin";
  const [rows, setRows] = useState([]);
  const [callers, setCallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("queue");
  const [jobFilter, setJobFilter] = useState("");
  const [callerFilter, setCallerFilter] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [r, c] = await Promise.all([fetchCallList(), isAdmin ? fetchCallers() : Promise.resolve([])]);
        setRows(r);
        setCallers(c);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const jobs = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => r.job && m.set(r.job_id, r.job));
    return [...m.entries()];
  }, [rows]);

  const stats = useMemo(() => {
    const s = { new: 0, callback: 0, retry: 0, done: 0, interested: 0 };
    rows.forEach((r) => {
      s[callBucket(r)]++;
      if (r.call_status === "connected_interested") s.interested++;
    });
    return s;
  }, [rows]);

  const callerName = (id) => callers.find((c) => c.id === id)?.full_name ?? "—";

  const visible = useMemo(
    () =>
      rows
        .filter((r) => {
          const b = callBucket(r);
          if (view === "queue" && b === "done") return false;
          if (view === "done" && b !== "done") return false;
          if (jobFilter && r.job_id !== jobFilter) return false;
          if (callerFilter && r.call_assigned_to !== callerFilter) return false;
          if (!q.trim()) return true;
          const c = r.candidate;
          return `${c.full_name} ${c.phone ?? ""} ${c.current_company ?? ""}`.toLowerCase().includes(q.toLowerCase());
        })
        .sort(sortForCalling),
    [rows, view, jobFilter, callerFilter, q]
  );

  const open = (id) => navigate(`/calling/${id}${jobFilter ? `?job=${jobFilter}` : ""}`);
  const firstToCall = rows
    .filter((r) => callBucket(r) !== "done" && (!jobFilter || r.job_id === jobFilter) && (!callerFilter || r.call_assigned_to === callerFilter))
    .sort(sortForCalling)[0];

  const countFor = (k) => (k === "queue" ? stats.new + stats.callback + stats.retry : k === "done" ? stats.done : rows.length);

  return (
    <div>
      <div className="page-head">
        <h1>{isAdmin ? "Calling list (all callers)" : "My calling list"}</h1>
        <div className="actions">
          {firstToCall && (
            <button className="primary" onClick={() => open(firstToCall.id)}>▶ Start calling</button>
          )}
        </div>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="stat-row">
        <div className="stat"><div className="num">{stats.new}</div><div className="lbl">Not called yet</div></div>
        <div className="stat"><div className="num">{stats.callback}</div><div className="lbl">Call back requested</div></div>
        <div className="stat"><div className="num">{stats.retry}</div><div className="lbl">To retry</div></div>
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
                <th>Candidate</th><th>Phone</th><th>Job</th><th>Status</th><th>Attempts</th><th>Last called</th>
                {isAdmin && <th>Caller</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)}>
                  <td>
                    <div className="cname">{r.candidate.full_name}</div>
                    <div className="muted small">{[r.candidate.current_title, r.candidate.current_company].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="mono">{r.candidate.phone ?? "—"}</td>
                  <td className="small"><span className="mono">{r.job?.job_code}</span> {r.job?.title}</td>
                  <td><StatusPill channel="call" value={r.call_status} /></td>
                  <td>{r.call_attempts}</td>
                  <td className="muted small">{r.last_called_at ? fmtDateTime(r.last_called_at) : "—"}</td>
                  {isAdmin && <td className="small">{callerName(r.call_assigned_to)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
