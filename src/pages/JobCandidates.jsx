import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Drawer from "../components/Drawer";
import StatusBadge from "../components/StatusBadge";
import StatusSelect from "../components/StatusSelect";
import UploadCandidates from "../components/UploadCandidates";
import CandidateDrawer from "../components/CandidateDrawer";
import { fetchStatuses } from "../lib/jobs";
import {
  CHANNELS, statusOptions, statusMeta, fetchJobByCode, fetchBatches, fetchJobCandidates, fetchCallers,
  updateJobCandidate, bulkUpdateIds, bulkUpdateBatch, removeFromJob, updateCandidate, deleteLot,
} from "../lib/outreach";
import "../outreach.css";

export default function JobCandidates() {
  const { jobCode } = useParams();
  const [job, setJob] = useState(null);
  const [jobStatuses, setJobStatuses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [callers, setCallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lotDel, setLotDel] = useState(null); // lot being deleted
  const [lotBusy, setLotBusy] = useState(false);

  const [batchFilter, setBatchFilter] = useState("all");
  const [q, setQ] = useState("");
  const [fChannel, setFChannel] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkChannel, setBulkChannel] = useState("linkedin");
  const [bulkStatus, setBulkStatus] = useState("sent");
  const [bulkCaller, setBulkCaller] = useState("");
  const [working, setWorking] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const loadAll = useCallback(async (j) => {
    const [b, r] = await Promise.all([fetchBatches(j.id), fetchJobCandidates(j.id)]);
    setBatches(b);
    setRows(r);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetchJobByCode(jobCode);
        if (!j) throw new Error("Job not found");
        setJob(j);
        const [s, c] = await Promise.all([fetchStatuses(), fetchCallers()]);
        setJobStatuses(s);
        setCallers(c);
        await loadAll(j);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobCode, loadAll]);

  const callerName = (id) => callers.find((c) => c.id === id)?.full_name;
  const batchCounts = useMemo(() => {
    const m = {};
    rows.forEach((r) => (m[r.batch_id] = (m[r.batch_id] ?? 0) + 1));
    return m;
  }, [rows]);

  const filterCol = CHANNELS.find((c) => c.key === fChannel)?.col;
  const visible = rows.filter((r) => {
    if (batchFilter !== "all" && r.batch_id !== batchFilter) return false;
    if (filterCol && fStatus && r[filterCol] !== fStatus) return false;
    if (!q.trim()) return true;
    const c = r.candidate;
    return `${c.full_name} ${c.email ?? ""} ${c.phone ?? ""} ${c.current_company ?? ""} ${c.current_title ?? ""}`
      .toLowerCase().includes(q.toLowerCase());
  });

  const activeBatch = batches.find((b) => b.id === batchFilter);
  const scopeCount = selected.size > 0 ? selected.size : activeBatch ? batchCounts[activeBatch.id] ?? 0 : 0;
  const scopeLabel = selected.size > 0 ? `${selected.size} selected` : activeBatch ? `all ${scopeCount} in "${activeBatch.tag}"` : "";

  const doDeleteLot = async (mode) => {
    setLotBusy(true); setError("");
    try {
      const r = await deleteLot(lotDel.id, mode);
      setNotice(mode === "delete" ? `Deleted lot "${r.tag}" and removed ${r.affected} candidates from this job.` : `Cleared calling assignment for ${r.affected} candidates in "${r.tag}".`);
      setLotDel(null);
      if (mode === "delete") setBatchFilter("all");
      await loadAll(job);
    } catch (e) { setError(e.message); } finally { setLotBusy(false); }
  };
  const lotRows = lotDel ? rows.filter((r) => r.batch_id === lotDel.id) : [];
  const lotWorked = lotRows.filter((r) => r.call_status !== "not_called" || r.rcs_status !== "not_started" || r.email_status !== "not_started" || r.linkedin_status !== "not_started").length;
  const lotAssigned = lotRows.filter((r) => r.call_assigned_to).length;

  const patchLocal = (id, row) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...row } : r)));

  const setChannel = async (row, col, value) => {
    const prev = row[col];
    patchLocal(row.id, { [col]: value });
    try {
      patchLocal(row.id, await updateJobCandidate(row.id, { [col]: value }));
    } catch (e) {
      patchLocal(row.id, { [col]: prev });
      setError(e.message);
    }
  };
  const assign = async (row, callerId) => {
    try { patchLocal(row.id, await updateJobCandidate(row.id, { call_assigned_to: callerId })); }
    catch (e) { setError(e.message); }
  };

  const runBulk = async (patch, what) => {
    if (!scopeCount) return;
    if (!window.confirm(`${what} for ${scopeLabel}?`)) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      if (selected.size > 0) await bulkUpdateIds([...selected], patch);
      else await bulkUpdateBatch(activeBatch.id, patch);
      await loadAll(job);
      setNotice(`Done: ${what} for ${scopeLabel}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  };

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));

  const openRow = rows.find((r) => r.id === openId);

  if (loading) return <div className="empty">Loading…</div>;
  if (!job) return <div className="msg error">{error || "Job not found"}</div>;

  return (
    <div>
      <div className="crumbs"><Link to={`/jobs/${job.job_code}`}>← {job.job_code}</Link></div>
      <div className="page-head">
        <div>
          <h1>{job.title || job.job_code}: Candidates & outreach</h1>
          <div className="muted">
            <StatusBadge statusKey={job.status} statuses={jobStatuses} /> {rows.length} candidates in {batches.length} lots
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => setUploadOpen(true)}>+ Upload candidates</button>
        </div>
      </div>

      {error && <div className="msg error">{error}</div>}
      {notice && <div className="msg ok">{notice}</div>}

      <div className="lots">
        <button className={`lot ${batchFilter === "all" ? "on" : ""}`} onClick={() => setBatchFilter("all")}>
          <b>All lots</b><span>{rows.length}</span>
        </button>
        {batches.map((b) => (
          <button key={b.id} className={`lot ${batchFilter === b.id ? "on" : ""}`} onClick={() => setBatchFilter(b.id)} title={b.source ?? ""}>
            <b>{b.tag}</b>
            <span>{batchCounts[b.id] ?? 0} · {new Date(b.created_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>

      {activeBatch && (
        <div className="lot-actions">
          <span className="muted small">Lot "{activeBatch.tag}" · {batchCounts[activeBatch.id] ?? 0} candidates</span>
          <button className="ghost sm danger" onClick={() => setLotDel(activeBatch)}>Delete lot / calling list…</button>
        </div>
      )}

      <div className={`bulkbar ${scopeCount ? "active" : ""}`}>
        {scopeCount ? (
          <>
            <div className="scope">Applies to <b>{scopeLabel}</b></div>
            <div className="bulk-row">
              <select value={bulkChannel} onChange={(e) => { setBulkChannel(e.target.value); setBulkStatus(statusOptions(e.target.value)[1].key); }}>
                {CHANNELS.map((c) => (<option key={c.key} value={c.key}>{c.label}</option>))}
              </select>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                {statusOptions(bulkChannel).map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
              </select>
              <button className="primary" disabled={working} onClick={() =>
                runBulk({ [CHANNELS.find((c) => c.key === bulkChannel).col]: bulkStatus },
                  `Set ${CHANNELS.find((c) => c.key === bulkChannel).label} to "${statusMeta(bulkChannel, bulkStatus).label}"`)}>
                Set status
              </button>
            </div>
            <div className="bulk-row">
              <select value={bulkCaller} onChange={(e) => setBulkCaller(e.target.value)}>
                <option value="">Unassign calling</option>
                {callers.map((p) => (<option key={p.id} value={p.id}>Assign calls to {p.full_name}</option>))}
              </select>
              <button className="ghost" disabled={working} onClick={() =>
                runBulk({ call_assigned_to: bulkCaller || null }, bulkCaller ? `Assign calling to ${callerName(bulkCaller)}` : "Unassign calling")}>
                Apply
              </button>
              {selected.size > 0 && <button className="link" onClick={() => setSelected(new Set())}>Clear selection</button>}
            </div>
          </>
        ) : (
          <div className="hint">Tick candidates, or pick a lot above, to change statuses or assign calling in bulk.</div>
        )}
      </div>

      <div className="filters">
        <input className="search left" placeholder="Search name, email, phone, company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="mini" value={fChannel} onChange={(e) => { setFChannel(e.target.value); setFStatus(""); }}>
          <option value="">Any channel</option>
          {CHANNELS.map((c) => (<option key={c.key} value={c.key}>{c.label}</option>))}
        </select>
        {fChannel && (
          <select className="mini" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Any status</option>
            {statusOptions(fChannel).map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
          </select>
        )}
        <span className="muted">{visible.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No candidates yet. Upload your first lot.</div>
      ) : (
        <div className="table-wrap">
          <table className="list cand">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
                <th>Candidate</th><th>Lot</th>
                {CHANNELS.map((c) => (<th key={c.key}>{c.label}</th>))}
                <th>Caller</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? "sel" : ""} onClick={() => setOpenId(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    <div className="cname">{r.candidate.full_name}</div>
                    <div className="muted small">
                      {[r.candidate.current_title, r.candidate.current_company].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="muted small">
                      {[r.candidate.email, r.candidate.phone].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="muted small">{r.batch?.tag ?? "—"}</td>
                  {CHANNELS.map((c) => (
                    <td key={c.key}>
                      <StatusSelect channel={c.key} value={r[c.col]} onChange={(v) => setChannel(r, c.col, v)} />
                    </td>
                  ))}
                  <td className="small">{callerName(r.call_assigned_to) ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload candidates" subtitle={job.job_code} width={640}>
        <UploadCandidates
          job={job}
          batches={batches}
          onDone={(batchId) => { loadAll(job); setBatchFilter(batchId); }}
        />
      </Drawer>

      <Drawer open={!!openRow} onClose={() => setOpenId(null)} title={openRow?.candidate.full_name ?? ""} subtitle={job.job_code} width={620}>
        {openRow && (
          <CandidateDrawer
            key={openRow.id}
            row={openRow}
            callers={callers}
            onChannel={(col, v) => setChannel(openRow, col, v)}
            onAssign={(id) => assign(openRow, id)}
            onSaveCandidate={async (patch) => {
              await updateCandidate(openRow.candidate_id, patch);
              patchLocal(openRow.id, { candidate: { ...openRow.candidate, ...patch } });
            }}
            onRemove={async () => {
              if (!window.confirm("Remove this candidate from the job? Their history on this job is deleted.")) return;
              try {
                await removeFromJob([openRow.id]);
                setOpenId(null);
                await loadAll(job);
              } catch (e) { setError(e.message); }
            }}
          />
        )}
      </Drawer>
      {lotDel && (
        <div className="modal-overlay" onClick={() => !lotBusy && setLotDel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete lot "{lotDel.tag}"</h3>
            <p className="muted small">{lotRows.length} candidates · {lotAssigned} assigned for calling · {lotWorked} already worked on (called or contacted).</p>
            <div className="lot-del-opts">
              <button className="ghost" disabled={lotBusy || lotAssigned === 0} onClick={() => doDeleteLot("unassign")}>
                <b>Clear the calling list only</b>
                <span className="muted small">Unassign callers from this lot. Candidates and their history stay on the job.</span>
              </button>
              <button className="ghost danger" disabled={lotBusy} onClick={() => {
                if (window.confirm(`Delete lot "${lotDel.tag}" and remove ${lotRows.length} candidates from this job? Their outreach history on this job is lost. This cannot be undone.`)) doDeleteLot("delete");
              }}>
                <b>Delete the whole lot</b>
                <span className="muted small">Removes the lot and its candidates from this job, including their calling assignments and history. People stay in the master candidate list.</span>
              </button>
            </div>
            <div className="pos-actions"><button className="ghost" disabled={lotBusy} onClick={() => setLotDel(null)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
