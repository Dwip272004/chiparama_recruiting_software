import { useEffect, useState } from "react";
import { deleteLot, fetchLotStats } from "../lib/outreach";

// Admin-only dialog: clear a lot's calling list, or delete the whole lot.
// lot = { id, tag }. onDone(mode, result) runs after a successful change.
export default function DeleteLotModal({ lot, onClose, onDone }) {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetchLotStats(lot.id).then((s) => live && setStats(s)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [lot.id]);

  const run = async (mode) => {
    setBusy(true); setError("");
    try {
      const r = await deleteLot(lot.id, mode);
      onDone(mode, r);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
        <h3>Delete lot "{lot.tag}"</h3>
        {error && <div className="msg error">{error}</div>}
        <p className="muted small">
          {stats ? `${stats.total} candidates · ${stats.assigned} assigned for calling · ${stats.worked} already worked on (called or contacted).` : "Loading…"}
        </p>
        <div className="lot-del-opts">
          <button className="ghost" disabled={busy || !stats || stats.assigned === 0} onClick={() => run("unassign")}>
            <b>Clear the calling list only</b>
            <span className="muted small">Unassign callers from this lot. Candidates and their history stay on the job.</span>
          </button>
          <button
            className="ghost danger"
            disabled={busy || !stats}
            onClick={() => {
              if (window.confirm(`Delete lot "${lot.tag}" and remove ${stats.total} candidates from this job? Their outreach history on this job is lost. This cannot be undone.`)) run("delete");
            }}
          >
            <b>Delete the whole lot</b>
            <span className="muted small">Removes the lot and its candidates from this job, including their calling assignments and history. People stay in the master candidate list.</span>
          </button>
        </div>
        <div className="pos-actions"><button className="ghost" disabled={busy} onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
