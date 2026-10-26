import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchJobs, fetchStatuses, jobTitle } from "../lib/jobs";
import StatusBadge from "../components/StatusBadge";
import SubmitJD from "../components/SubmitJD";
import { fetchCallList, callBucket } from "../lib/outreach";

export default function Dashboard() {
  const { profile, session, can } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(null);

  const load = async () => {
    try {
      const [j, s] = await Promise.all([fetchJobs(), fetchStatuses()]);
      setJobs(j);
      setStatuses(s);
    } catch (e) {
      setError(e.message);
    }
  };
  const [callQueue, setCallQueue] = useState(null);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!can("calling.view")) return;
    fetchCallList()
      .then((rows) => {
        const b = rows.map(callBucket);
        setCallQueue({ todo: b.filter((x) => x === "new" || x === "retry").length, due: b.filter((x) => x === "followup").length });
      })
      .catch(() => {});
    // eslint-disable-next-line
  }, []);

  const reviewer = can("jobs.review");
  const pending = jobs.filter((j) => j.status === "pending_review");
  const mine = jobs.filter((j) => j.submitted_by === session.user.id).slice(0, 8);
  const counts = {};
  jobs.forEach((j) => (counts[j.status] = (counts[j.status] ?? 0) + 1));

  const JobRow = ({ j }) => (
    <li onClick={() => navigate(`/jobs/${j.job_code}`)}>
      <span className="mono">{j.job_code}</span>
      <span className={j.title ? "" : "muted"}>{jobTitle(j)}</span>
      <StatusBadge statusKey={j.status} statuses={statuses} />
    </li>
  );

  return (
    <div>
      <div className="page-head">
        <h1>Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="stat-row">
        {statuses
          .filter((s) => s.is_active || counts[s.key])
          .map((s) => (
            <div className="stat" key={s.key} onClick={() => navigate("/jobs")}>
              <div className="num">{counts[s.key] ?? 0}</div>
              <div className="lbl">{s.label}</div>
            </div>
          ))}
      </div>

      <div className="dash-grid">
        {can("jobs.submit") && (
          <section className="card">
            <h3>Paste a job description</h3>
            <p className="hint">The admins will review it and turn it into a structured job with a Job ID.</p>
            {justSubmitted && (
              <div className="msg ok">
                Submitted as {justSubmitted.job_code}. The admins have it for review.
              </div>
            )}
            <SubmitJD
              onSubmitted={(job) => {
                setJustSubmitted(job);
                load();
              }}
            />
          </section>
        )}

        <div className="stack">
          {can("calling.view") && (
            <section className="card">
              <h3>Your calling queue</h3>
              {callQueue === null ? (
                <div className="empty small">Loading…</div>
              ) : (
                <div className="muted">
                  <b>{callQueue.todo}</b> to call · <b className={callQueue.due ? "due" : ""}>{callQueue.due}</b> follow-ups due
                </div>
              )}
              <button className="primary" onClick={() => navigate("/calling")}>Open calling list</button>
            </section>
          )}
          {reviewer && (
            <section className="card">
              <h3>Awaiting review <span className="count">{pending.length}</span></h3>
              {pending.length === 0 ? (
                <div className="empty small">Nothing waiting.</div>
              ) : (
                <ul className="mini-list">{pending.map((j) => <JobRow key={j.id} j={j} />)}</ul>
              )}
            </section>
          )}
          <section className="card">
            <h3>{reviewer ? "Recently submitted by you" : "Your submissions"}</h3>
            {mine.length === 0 ? (
              <div className="empty small">Nothing yet.</div>
            ) : (
              <ul className="mini-list">{mine.map((j) => <JobRow key={j.id} j={j} />)}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
