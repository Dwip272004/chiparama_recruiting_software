import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchJobs, fetchStatuses, updateJob, jobTitle } from "../lib/jobs";
import Drawer from "../components/Drawer";
import StatusBadge from "../components/StatusBadge";
import JobDetail from "../components/JobDetail";
import SubmitJD from "../components/SubmitJD";
import ManageStatuses from "../components/ManageStatuses";

export default function Jobs() {
  const { can } = useAuth();
  const { jobCode } = useParams();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(null); // "submit" | "statuses" | null

  const load = useCallback(async () => {
    try {
      const [j, s] = await Promise.all([fetchJobs(), fetchStatuses()]);
      setJobs(j);
      setStatuses(s);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = jobCode ? jobs.find((j) => j.job_code === jobCode) : null;

  const counts = useMemo(() => {
    const c = {};
    jobs.forEach((j) => (c[j.status] = (c[j.status] ?? 0) + 1));
    return c;
  }, [jobs]);

  const visible = jobs.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (!q.trim()) return true;
    const hay = `${j.job_code} ${j.title ?? ""} ${j.client_name ?? ""} ${j.location ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const canReview = can("jobs.review");

  const onSave = async (patch) => {
    const updated = await updateJob(selected.id, patch);
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    if (updated.job_code !== jobCode) navigate(`/jobs/${updated.job_code}`, { replace: true });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Jobs</h1>
        <div className="actions">
          {can("jobs.statuses") && (
            <button className="ghost" onClick={() => setPanel("statuses")}>Manage statuses</button>
          )}
          {can("jobs.submit") && (
            <button className="primary" onClick={() => setPanel("submit")}>+ Submit JD</button>
          )}
        </div>
      </div>

      <div className="filters">
        <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All <span>{jobs.length}</span>
        </button>
        {statuses
          .filter((s) => s.is_active || counts[s.key])
          .map((s) => (
            <button key={s.key} className={`chip ${filter === s.key ? "on" : ""}`} onClick={() => setFilter(s.key)}>
              {s.label} <span>{counts[s.key] ?? 0}</span>
            </button>
          ))}
        <input className="search" placeholder="Search ID, title, client, location…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="msg error">{error}</div>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty">No jobs yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr><th>Job ID</th><th>Title</th><th>Client</th><th>Location</th><th>Status</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {visible.map((j) => (
                <tr key={j.id} className={selected?.id === j.id ? "sel" : ""} onClick={() => navigate(`/jobs/${j.job_code}`)}>
                  <td className="mono">{j.job_code}</td>
                  <td className={j.title ? "" : "muted"}>{jobTitle(j)}</td>
                  <td>{j.client_name ?? "—"}</td>
                  <td>{j.location ?? "—"}</td>
                  <td><StatusBadge statusKey={j.status} statuses={statuses} /></td>
                  <td className="muted">{new Date(j.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={!!selected}
        onClose={() => navigate("/jobs")}
        title={selected ? jobTitle(selected) : ""}
        subtitle={selected?.job_code}
      >
        {selected && (
          <JobDetail
            key={`${selected.id}-${selected.updated_at}`}
            job={selected}
            statuses={statuses}
            canEdit={canReview}
            onSave={onSave}
            onManage={can("candidates.manage") ? () => navigate(`/jobs/${selected.job_code}/candidates`) : undefined}
          />
        )}
      </Drawer>

      <Drawer open={panel === "submit"} onClose={() => setPanel(null)} title="Submit a job description" width={600}>
        <SubmitJD
          onSubmitted={(job) => {
            setPanel(null);
            setJobs((prev) => [job, ...prev]);
            navigate(`/jobs/${job.job_code}`);
          }}
        />
      </Drawer>

      <Drawer open={panel === "statuses"} onClose={() => setPanel(null)} title="Manage statuses" width={480}>
        <ManageStatuses statuses={statuses} onChanged={load} />
      </Drawer>
    </div>
  );
}
