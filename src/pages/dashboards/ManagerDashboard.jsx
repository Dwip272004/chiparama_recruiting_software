import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import SubmitJD from "../../components/SubmitJD";
import { StatusPill } from "../../components/StatusSelect";
import { fetchStatuses, fetchJobs, jobTitle } from "../../lib/jobs";
import { fetchMyDashboard, timeAgo, pct } from "../../lib/dashboard";
import { fetchCallList, callBucket, sortForCalling } from "../../lib/outreach";
import "../../dashboard.css";

export default function ManagerDashboard() {
  const { profile, session, can } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [queue, setQueue] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(null);

  const load = useCallback(async () => {
    try {
      const [dash, rows, j, st] = await Promise.all([fetchMyDashboard(), fetchCallList(), fetchJobs(), fetchStatuses()]);
      setD(dash);
      setQueue(rows.filter((r) => callBucket(r) !== "done").sort(sortForCalling));
      setJobs(j);
      setStatuses(st);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !d) return <div className="msg error">{error}</div>;
  if (!d) return <div className="empty">Loading…</div>;

  const q = d.queue;
  const remaining = q.not_called + q.callback + q.retry;
  const openJobs = jobs.filter((j) => j.status === "open" || j.status === "active");
  const mine = jobs.filter((j) => j.submitted_by === session.user.id).slice(0, 6);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hi{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
          <div className="muted small">Your calling dashboard</div>
        </div>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>
      {error && <div className="msg error">{error}</div>}

      <section className="card hero">
        <div className="hero-main">
          <h2>{remaining > 0 ? `${remaining} candidates left to call` : "Nothing left to call right now"}</h2>
          <div className="muted">
            {q.assigned === 0
              ? "The admins haven't assigned you any candidates yet."
              : `${q.not_called} not called yet · ${q.callback} asked for a call back · ${q.retry} to retry`}
          </div>
          <div className="progress big"><i style={{ width: `${pct(q.done + 0, q.assigned)}%` }} /></div>
          <div className="muted small">{q.done} of {q.assigned} completed · {q.interested} interested</div>
        </div>
        {queue.length > 0 && (
          <button className="primary cta" onClick={() => navigate(`/calling/${queue[0].id}`)}>▶ Start calling</button>
        )}
      </section>

      <div className="kpis">
        <div className="kpi"><div className="num">{d.today.calls}</div><div className="lbl">Calls today</div></div>
        <div className="kpi"><div className="num">{d.today.connected}</div><div className="lbl">Connected today</div></div>
        <div className="kpi good"><div className="num">{d.today.interested}</div><div className="lbl">Interested today</div></div>
        <div className="kpi"><div className="num">{d.week_calls}</div><div className="lbl">Calls in last 7 days</div></div>
      </div>

      <div className="dash-two">
        <section className="card">
          <h3>Up next</h3>
          {queue.length === 0 ? (
            <div className="empty small">Your queue is empty.</div>
          ) : (
            <ul className="mini-list wide">
              {queue.slice(0, 6).map((r) => (
                <li key={r.id} onClick={() => navigate(`/calling/${r.id}`)}>
                  <span><span className="cname">{r.candidate.full_name}</span>
                    <span className="muted small"> {r.candidate.current_company ? `· ${r.candidate.current_company}` : ""}</span></span>
                  <span className="mono small">{r.job?.job_code}</span>
                  <StatusPill channel="call" value={r.call_status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Your recent calls</h3>
          {d.recent.length === 0 ? (
            <div className="empty small">No calls logged yet.</div>
          ) : (
            <ul className="feed">
              {d.recent.map((a) => (
                <li key={a.id}>
                  <div className="row-between">
                    <b>{a.candidate}</b>
                    <StatusPill channel="call" value={a.to_status} />
                  </div>
                  <div className="muted small">{a.job_code} · {timeAgo(a.created_at)}{a.note ? ` · ${a.note.slice(0, 70)}` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h2 className="section-title">Open roles</h2>
      {openJobs.length === 0 ? (
        <div className="empty small">No open roles right now.</div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Job</th><th>Client</th><th>Location</th><th>Status</th></tr></thead>
            <tbody>
              {openJobs.map((j) => (
                <tr key={j.id} onClick={() => navigate(`/jobs/${j.job_code}`)}>
                  <td><span className="mono">{j.job_code}</span> {jobTitle(j)}</td>
                  <td className="muted">{j.client_name ?? "—"}</td>
                  <td className="muted">{j.location ?? "—"}</td>
                  <td><StatusBadge statusKey={j.status} statuses={statuses} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {can("jobs.submit") && (
        <div className="dash-two" style={{ marginTop: 24 }}>
          <section className="card">
            <h3>Paste a job description</h3>
            <p className="hint">The admins will review it and turn it into a structured job with a Job ID.</p>
            {justSubmitted && <div className="msg ok">Submitted as {justSubmitted.job_code}. The admins have it for review.</div>}
            <SubmitJD onSubmitted={(job) => { setJustSubmitted(job); load(); }} />
          </section>
          <section className="card">
            <h3>Your submissions</h3>
            {mine.length === 0 ? (
              <div className="empty small">Nothing yet.</div>
            ) : (
              <ul className="mini-list">
                {mine.map((j) => (
                  <li key={j.id} onClick={() => navigate(`/jobs/${j.job_code}`)}>
                    <span className="mono">{j.job_code}</span>
                    <span className={j.title ? "" : "muted"}>{jobTitle(j)}</span>
                    <StatusBadge statusKey={j.status} statuses={statuses} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
