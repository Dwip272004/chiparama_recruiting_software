import { useCallback, useEffect, useMemo, useState } from "react";
import { jobCallingSummary, assignJobCalling } from "../lib/assign";
import { fetchBatches } from "../lib/email";
import { pct } from "../lib/dashboard";

// Job-level calling assignment, shown inside the job's detail pane (admins only).
export default function CallingAssign({ jobId }) {
  const [sum, setSum] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState("");
  const [scope, setScope] = useState("unassigned");
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmUn, setConfirmUn] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try { setSum(await jobCallingSummary(jobId, batchId)); } catch (e) { setMsg({ t: "error", text: e.message }); }
  }, [jobId, batchId]);

  useEffect(() => { fetchBatches(jobId).then(setBatches).catch(() => {}); }, [jobId]);
  useEffect(() => { load(); }, [load]);

  const callers = sum?.callers ?? [];
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...picked];
  const count = sum ? (scope === "unassigned" ? sum.unassigned : sum.uncalled) : 0;
  const each = ids.length ? Math.floor(count / ids.length) : 0;
  const names = useMemo(() => callers.filter((c) => picked.has(c.id)).map((c) => c.name.split(" ")[0]), [callers, picked]);

  const run = async (callerIds) => {
    setBusy(true); setMsg(null);
    try {
      const r = await assignJobCalling(jobId, callerIds, scope, batchId);
      setMsg({
        t: "ok",
        text: callerIds.length
          ? `Assigned ${r.assigned} candidates${r.per_caller?.length ? ": " + r.per_caller.map((p) => `${p.name} ${p.count}`).join(", ") : ""}.`
          : `${r.unassigned ?? 0} not-yet-called candidates are now unassigned.`,
      });
      setPicked(new Set()); setConfirmUn(false);
      await load();
    } catch (e) { setMsg({ t: "error", text: e.message }); } finally { setBusy(false); }
  };

  return (
    <section className="assign-card">
      <button type="button" className="assign-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="assign-title">Calling assignment</span>
        {sum && <span className="muted small">{sum.total} candidates · <b className={sum.unassigned ? "neg" : "pos"}>{sum.unassigned} unassigned</b></span>}
        <svg className={`coll-chev ${open ? "flip" : ""}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="assign-body">
          {!sum ? <div className="muted small">Loading…</div> : sum.total === 0 ? (
            <div className="muted small">No candidates on this job yet. Upload a lot from the candidates page first.</div>
          ) : (
            <>
              <div className="assign-callers">
                {callers.map((c) => (
                  <label key={c.id} className={`assign-caller ${picked.has(c.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    <div className="ac-main">
                      <div className="row-between"><b>{c.name}</b><span className="small"><b>{c.assigned}</b> assigned</span></div>
                      <div className="progress"><i style={{ width: `${pct(c.assigned - c.not_called, c.assigned)}%` }} /></div>
                      <div className="muted small">{c.not_called} not called · {c.assigned - c.not_called} called</div>
                    </div>
                  </label>
                ))}
                {callers.length === 0 && <div className="muted small">No recruiting managers found.</div>}
              </div>

              <div className="two-col">
                <label>Which candidates
                  <select value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="unassigned">Only unassigned ({sum.unassigned})</option>
                    <option value="uncalled">All not yet called, rebalance ({sum.uncalled})</option>
                  </select>
                </label>
                <label>Upload lot
                  <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    <option value="">All lots</option>
                    {batches.map((b) => (<option key={b.id} value={b.id}>{b.tag}</option>))}
                  </select>
                </label>
              </div>

              {msg && <div className={`msg ${msg.t === "ok" ? "ok" : "error"}`}>{msg.text}</div>}

              <div className="assign-actions">
                <button type="button" className="primary" disabled={busy || ids.length === 0 || count === 0} onClick={() => run(ids)}>
                  {busy ? "Assigning…" : ids.length === 0 ? "Pick who will call" : count === 0 ? "Nobody in this selection" : `Assign ${count} to ${names.join(" & ")}${ids.length > 1 ? ` (~${each} each)` : ""}`}
                </button>
                {!confirmUn ? (
                  <button type="button" className="ghost" disabled={busy || sum.uncalled === 0} onClick={() => { setScope("uncalled"); setConfirmUn(true); }}>Take back not-yet-called</button>
                ) : (
                  <button type="button" className="ghost danger" disabled={busy} onClick={() => run([])}>Confirm: unassign {sum.uncalled} not-called</button>
                )}
              </div>
              <div className="hint">Candidates already called stay with whoever called them. Splits are even, in upload order. Callers get a notification.</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
