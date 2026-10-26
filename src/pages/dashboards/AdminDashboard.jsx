import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { fetchStatuses, fetchJobs, jobTitle } from "../../lib/jobs";
import { fetchAdminDashboard, timeAgo, pct } from "../../lib/dashboard";
import { CHANNELS, statusOptions, statusMeta, channelByKey } from "../../lib/outreach";
import "../../dashboard.css";

function ChannelBar({ channel, counts }) {
  const opts = statusOptions(channel.key);
  const total = opts.reduce((n, s) => n + (counts[s.key] ?? 0), 0);
  const first = opts[0].key; // not started / not called
  return (
    <div className="card funnel">
      <div className="row-between">
        <h3>{channel.label}</h3>
        <span className="muted small">{total - (counts[first] ?? 0)} of {total} touched</span>
      </div>
      <div className="bar">
        {opts.filter((s) => counts[s.key]).map((s) => (
          <i key={s.key} className={`seg-${s.color}`} style={{ width: `${pct(counts[s.key], total)}%` }} title={`${s.label}: ${counts[s.key]}`} />
        ))}
      </div>
      <div className="legend">
        {opts.filter((s) => counts[s.key]).map((s) => (
          <span key={s.key}><i className={`dot seg-${s.color}`} /> {s.label} <b>{counts[s.key]}</b></span>
        ))}
        {total === 0 && <span className="muted">No candidates yet</span>}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const [dash, st, jobs] = await Promise.all([fetchAdminDashboard(), fetchStatuses(), fetchJobs()]);
      setD(dash);
      setStatuses(st);
      setPending(jobs.filter((j) => j.status === "pending_review"));
      setUpdated(new Date());
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

  const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const openJobs = (d.jobs_by_status.open ?? 0) + (d.jobs_by_status.active ?? 0);
  const callsToday = sum(d.callers, "calls_today");
  const interested = sum(d.jobs_progress, "interested");

  const describe = (a) => {
    const ch = channelByKey(a.channel);
    return `${ch?.label ?? a.channel} → ${statusMeta(a.channel, a.to_status)?.label ?? a.to_status}`;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
          <div className="muted small">Admin dashboard · updated {updated ? updated.toLocaleTimeString() : ""}</div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={load}>Refresh</button>
          <button className="primary" onClick={() => navigate("/jobs")}>Jobs</button>
        </div>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="kpis">
        <div className={`kpi click ${pending.length ? "alert" : ""}`} onClick={() => navigate("/jobs")}>
          <div className="num">{pending.length}</div><div className="lbl">JDs awaiting review</div>
        </div>
        <div className="kpi click t-blue" onClick={() => navigate("/jobs")}>
          <div className="num">{openJobs}</div><div className="lbl">Open / active jobs</div>
        </div>
        <div className="kpi t-purple">
          <div className="num">{d.totals.job_candidates}</div><div className="lbl">Candidates in pipelines</div>
        </div>
        <div className="kpi t-orange">
          <div className="num">{d.totals.unassigned_calls}</div><div className="lbl">Not yet assigned for calling</div>
        </div>
        <div className="kpi t-teal">
          <div className="num">{callsToday}</div><div className="lbl">Calls made today</div>
        </div>
        <div className="kpi good">
          <div className="num">{interested}</div><div className="lbl">Interested candidates</div>
        </div>
      </div>

      <div className="dash-two">
        <section className="card">
          <h3>Awaiting review <span className="count">{pending.length}</span></h3>
          {pending.length === 0 ? (
            <div className="empty small">Nothing waiting. 🎉</div>
          ) : (
            <ul className="mini-list">
              {pending.slice(0, 6).map((j) => (
                <li key={j.id} onClick={() => navigate(`/jobs/${j.job_code}`)}>
                  <span className="mono">{j.job_code}</span>
                  <span>{jobTitle(j)}</span>
                  <span className="muted small">{j.submitted_by_name ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Recent activity</h3>
          {d.recent.length === 0 ? (
            <div className="empty small">No outreach activity yet.</div>
          ) : (
            <ul className="feed">
              {d.recent.map((a) => (
                <li key={a.id}>
                  <div><b>{a.actor_name ?? "System"}</b> · {a.candidate}</div>
                  <div className="muted small">{describe(a)} · {a.job_code} · {timeAgo(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h2 className="section-title">Outreach funnel (all jobs)</h2>
      <div className="funnel-grid">
        {CHANNELS.map((c) => (<ChannelBar key={c.key} channel={c} counts={d.channels[c.key] ?? {}} />))}
      </div>

      <h2 className="section-title">Calling team</h2>
      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr><th>Caller</th><th>Assigned</th><th>Not called</th><th style={{ width: 180 }}>Progress</th><th>Connected</th><th>Interested</th><th>Calls today</th><th>Last 7 days</th></tr>
          </thead>
          <tbody>
            {d.callers.length === 0 && <tr><td colSpan={8} className="empty small">No callers yet.</td></tr>}
            {d.callers.map((c) => (
              <tr key={c.id}>
                <td className="cname">{c.name}</td>
                <td>{c.assigned}</td>
                <td>{c.not_called}</td>
                <td>
                  <div className="progress"><i style={{ width: `${pct(c.called, c.assigned)}%` }} /></div>
                  <span className="muted small">{c.called} / {c.assigned} called ({pct(c.called, c.assigned)}%)</span>
                </td>
                <td>{c.connected}</td>
                <td>{c.interested}</td>
                <td><b>{c.calls_today}</b></td>
                <td>{c.calls_7d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Jobs pipeline</h2>
      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr><th>Job</th><th>Client</th><th>Status</th><th>Candidates</th><th>Contacted</th><th>Replied</th><th>Interested</th></tr>
          </thead>
          <tbody>
            {d.jobs_progress.length === 0 && <tr><td colSpan={7} className="empty small">No published jobs yet.</td></tr>}
            {d.jobs_progress.map((j) => (
              <tr key={j.id} onClick={() => navigate(`/jobs/${j.job_code}/candidates`)}>
                <td><span className="mono">{j.job_code}</span> {j.title}</td>
                <td className="muted">{j.client_name ?? "—"}</td>
                <td><StatusBadge statusKey={j.status} statuses={statuses} /></td>
                <td>{j.candidates}</td>
                <td>{j.contacted} <span className="muted small">({pct(j.contacted, j.candidates)}%)</span></td>
                <td>{j.replied}</td>
                <td><b>{j.interested}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
