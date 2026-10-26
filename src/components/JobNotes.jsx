import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchJobNotes, addJobNote, deleteJobNote } from "../lib/feedback";
import { timeAgo } from "../lib/dashboard";
import { initials } from "../lib/outreach";
import { ROLES } from "../lib/roles";

export default function JobNotes({ jobId }) {
  const { session, role } = useAuth();
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setNotes(await fetchJobNotes(jobId)); } catch (e) { setError(e.message); setNotes([]); }
  }, [jobId]);
  useEffect(() => { setNotes(null); load(); }, [load]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true); setError("");
    try { await addJobNote(jobId, text.trim()); setText(""); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await deleteJobNote(id); await load(); } catch (e) { setError(e.message); }
  };

  return (
    <section className="job-notes">
      <h4>Notes {notes && notes.length > 0 && <span className="count-pill">{notes.length}</span>}</h4>
      <div className="note-compose">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Add a note for the team — client feedback, what to look for, call insights…"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); add(); } }} />
        <div className="row-between">
          <span className="hint">Visible to all admins and hiring managers · Ctrl/⌘ + Enter to post</span>
          <button type="button" className="primary sm" disabled={busy || !text.trim()} onClick={add}>{busy ? "Posting…" : "Post note"}</button>
        </div>
      </div>
      {error && <div className="msg error">{error}</div>}
      {notes === null ? <div className="muted small">Loading notes…</div> : notes.length === 0 ? (
        <div className="muted small">No notes yet.</div>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id} className={`note-item role-${n.author_role}`}>
              <span className="note-avatar" data-role={n.author_role}>{initials(n.author_name || "")}</span>
              <div className="note-main">
                <div className="note-meta">
                  <b>{n.author_name}</b> <span className="muted">· {ROLES[n.author_role]?.label} · {timeAgo(n.created_at)}</span>
                  {(n.author_id === session.user.id || role === "super_admin") && (
                    <button type="button" className="link danger small" onClick={() => remove(n.id)}>Delete</button>
                  )}
                </div>
                <div className="pre">{n.body}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
