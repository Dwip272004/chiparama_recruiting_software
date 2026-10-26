import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { CATEGORIES, AREAS, FB_STATUSES, fbMeta, fetchFeedback, submitFeedback, updateFeedback } from "../lib/feedback";
import { timeAgo } from "../lib/dashboard";

const Tag = ({ list, k }) => {
  const m = fbMeta(list, k);
  return <span className={`status status-${m?.color ?? "gray"}`}>{m?.label ?? k}</span>;
};

function Item({ f, owner, onSaved, setError }) {
  const [open, setOpen] = useState(owner && f.status === "new");
  const [status, setStatus] = useState(f.status);
  const [reply, setReply] = useState(f.response ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = status !== f.status || reply !== (f.response ?? "");

  const save = async () => {
    setBusy(true); setError("");
    try {
      await updateFeedback(f.id, { status, response: reply.trim() || null });
      await onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <li className={`fb-item ${f.status}`}>
      <button type="button" className="fb-head" onClick={() => setOpen((o) => !o)}>
        <div className="fb-title">
          <Tag list={CATEGORIES} k={f.category} />
          <span className="fb-msg">{f.message}</span>
        </div>
        <div className="fb-side">
          {owner && <span className="muted small">{f.user_name}</span>}
          <Tag list={FB_STATUSES} k={f.status} />
          <span className="muted small">{timeAgo(f.created_at)}</span>
        </div>
      </button>
      {open && (
        <div className="fb-body">
          <div className="pre">{f.message}</div>
          <div className="muted small">{[f.area && `About: ${f.area}`, owner && `From ${f.user_name}`].filter(Boolean).join(" · ")}</div>
          {owner ? (
            <div className="fb-reply">
              <div className="two-col">
                <label>Status
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {FB_STATUSES.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
                  </select>
                </label>
              </div>
              <label>Reply to {f.user_name?.split(" ")[0]}
                <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Let them know what you'll do, or ask a follow-up…" />
              </label>
              <div className="row-end"><button type="button" className="primary sm" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save & notify"}</button></div>
            </div>
          ) : f.response ? (
            <div className="fb-answer"><b>{f.handled_by_name ?? "Dwip"}</b> replied · {timeAgo(f.handled_at)}<div className="pre">{f.response}</div></div>
          ) : (
            <div className="muted small">Dwip hasn't replied yet.</div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Feedback() {
  const { can } = useAuth();
  const owner = can("feedback.manage");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [category, setCategory] = useState("idea");
  const [area, setArea] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(owner ? "new" : "all");

  const load = useCallback(async () => {
    try { setItems(await fetchFeedback()); } catch (e) { setError(e.message); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (message.trim().length < 3) return setError("Write a few words so Dwip can act on it.");
    setBusy(true); setError(""); setOk("");
    try {
      await submitFeedback({ category, area, message: message.trim() });
      setMessage(""); setOk("Thanks! Dwip has been notified.");
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const mine = useMemo(() => (items ?? []), [items]);
  const counts = useMemo(() => {
    const c = { all: mine.length };
    FB_STATUSES.forEach((s) => (c[s.key] = mine.filter((f) => f.status === s.key).length));
    return c;
  }, [mine]);
  const shown = filter === "all" ? mine : mine.filter((f) => f.status === filter);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Feedback</h1>
          <div className="muted small">{owner ? "Everything the team has sent you. Reply or change status and they're notified." : "Tell Dwip what's broken, missing or working well. You'll see replies here."}</div>
        </div>
      </div>
      {error && <div className="msg error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className={owner ? "fb-layout owner" : "fb-layout"}>
        <form className="card fb-form" onSubmit={send}>
          <h3>Share feedback</h3>
          <div className="cat-row" role="radiogroup" aria-label="Type of feedback">
            {CATEGORIES.map((c) => (
              <button type="button" key={c.key} role="radio" aria-checked={category === c.key}
                className={`chip tone-chip ${category === c.key ? "on" : ""} c-${c.color}`} onClick={() => setCategory(c.key)}>{c.label}</button>
            ))}
          </div>
          <label>About
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Pick an area (optional)</option>
              {AREAS.map((a) => (<option key={a}>{a}</option>))}
            </select>
          </label>
          <label>Your feedback
            <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would make your work easier? Steps to reproduce help for bugs." />
          </label>
          {ok && <div className="msg ok">{ok}</div>}
          <button className="primary" disabled={busy}>{busy ? "Sending…" : "Send feedback"}</button>
        </form>

        <section className="fb-list-wrap">
          <div className="filters">
            <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>{owner ? "All" : "My feedback"} <span>{counts.all}</span></button>
            {FB_STATUSES.map((s) => (
              <button key={s.key} className={`chip ${filter === s.key ? "on" : ""}`} onClick={() => setFilter(s.key)}>{s.label} <span>{counts[s.key]}</span></button>
            ))}
          </div>
          {items === null ? <div className="empty">Loading…</div> : shown.length === 0 ? (
            <div className="empty">{owner ? "Nothing here." : "You haven't sent any feedback yet."}</div>
          ) : (
            <ul className="fb-list">
              {shown.map((f) => (<Item key={f.id} f={f} owner={owner} onSaved={load} setError={setError} />))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
