import { useState } from "react";
import { addStatus, updateStatus, slugify } from "../lib/jobs";

const COLORS = ["gray", "blue", "green", "orange", "amber", "purple", "red"];

export default function ManageStatuses({ statuses, onChanged }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("blue");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    const key = slugify(label);
    if (!key) return setError("Enter a status name.");
    const max = Math.max(0, ...statuses.map((s) => s.sort_order));
    run(async () => {
      await addStatus({ key, label: label.trim(), color, sort_order: max + 10 });
      setLabel("");
    });
  };

  return (
    <div className="stack">
      <p className="hint">
        These appear in every job's status dropdown. "Pending Review" is used by the system for new JDs and can't be removed.
        Deactivating a status hides it from the dropdown but keeps existing jobs unchanged.
      </p>
      <ul className="status-list">
        {statuses.map((s) => (
          <li key={s.key}>
            <span className={`status status-${s.color}`}>{s.label}</span>
            <select
              value={s.color}
              disabled={busy}
              onChange={(e) => run(() => updateStatus(s.key, { color: e.target.value }))}
            >
              {COLORS.map((c) => (<option key={c}>{c}</option>))}
            </select>
            {s.key !== "pending_review" && (
              <button
                className="link"
                disabled={busy}
                onClick={() => run(() => updateStatus(s.key, { is_active: !s.is_active }))}
              >
                {s.is_active ? "Deactivate" : "Activate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="add-status" onSubmit={add}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New status, e.g. Awaiting Client" />
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          {COLORS.map((c) => (<option key={c}>{c}</option>))}
        </select>
        <button className="primary" disabled={busy}>Add</button>
      </form>
      {error && <div className="msg error">{error}</div>}
    </div>
  );
}
