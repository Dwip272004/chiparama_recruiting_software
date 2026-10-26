import { useState } from "react";
import { submitJD } from "../lib/jobs";

// Paste a raw JD. It lands in "Pending Review" for the admins to structure.
export default function SubmitJD({ onSubmitted }) {
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!raw.trim()) return setError("Paste the job description first.");
    setBusy(true);
    setError("");
    try {
      const job = await submitJD({ raw_jd: raw, intake_note: note });
      setRaw("");
      setNote("");
      onSubmitted?.(job);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>
        Job description
        <textarea
          rows={12}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste the JD exactly as you received it (email, PDF text, message…)"
        />
      </label>
      <label>
        Note for the admins <span className="hint">(optional: client, urgency, source)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="msg error">{error}</div>}
      <div className="row-end">
        <button className="primary" disabled={busy}>
          {busy ? "Submitting…" : "Submit for review"}
        </button>
      </div>
    </form>
  );
}
