import { useMemo, useState } from "react";
import { parseDelimited, mapTable, createBatch, addToBatch, downloadTemplate } from "../lib/outreach";

const today = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Upload a CSV / pasted sheet as a tagged lot.
export default function UploadCandidates({ job, batches, onDone }) {
  const [lot, setLot] = useState("new"); // "new" or an existing batch id
  const [tag, setTag] = useState(`Lot ${batches.length + 1} · ${today()}`);
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const parsed = useMemo(() => (text.trim() ? mapTable(parseDelimited(text)) : null), [text]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
    if (lot === "new" && !source) setSource(f.name);
    e.target.value = "";
  };

  const submit = async () => {
    setError("");
    if (!parsed?.valid.length) return setError("No valid rows to upload.");
    if (lot === "new" && !tag.trim()) return setError("Give this lot a tag.");
    setBusy(true);
    try {
      const batchId = lot === "new" ? await createBatch(job.id, tag, source) : lot;
      const res = await addToBatch(batchId, parsed.valid);
      setResult(res);
      onDone?.(batchId, res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="stack">
        <div className="msg ok">
          <b>{result.added}</b> candidates added to the lot.
          {result.already_on_job > 0 && <> {result.already_on_job} were already on this job and were skipped.</>}
          {result.skipped > 0 && <> {result.skipped} rows skipped (missing details).</>}
          {" "}{result.new_people} were new to your database.
        </div>
        <button className="ghost" onClick={() => { setResult(null); setText(""); setLot("new"); setTag(`Lot ${batches.length + 2} · ${today()}`); }}>
          Upload another lot
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="two-col">
        <label>
          Lot
          <select value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="new">Create a new lot</option>
            {batches.map((b) => (<option key={b.id} value={b.id}>Add to: {b.tag}</option>))}
          </select>
        </label>
        {lot === "new" && (
          <label>
            Lot tag <span className="hint">(used to change statuses lot-wise)</span>
            <input value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
        )}
      </div>
      {lot === "new" && (
        <label>
          Source <span className="hint">(optional: LinkedIn export, Apollo, referral…)</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
      )}

      <label>
        Upload a CSV, or paste rows from a sheet
        <input type="file" accept=".csv,.tsv,.txt" onChange={onFile} />
      </label>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"name,current title,company,location,open to work,experience years,Direct phone 1,phone 2,phone 3,work email,personal email,recruiter profile"}
      />
      <div className="hint">
        Use the outreach list template: <button type="button" className="link" onClick={downloadTemplate}>download it here</button>.
        First row must be headers. Each row needs a name and at least one of phone, email or a profile link. People already
        in your database are matched by email, recruiter profile, LinkedIn or phone, so nobody is duplicated across jobs.
      </div>

      {parsed && (
        <div className="preview">
          <div>
            <b>{parsed.valid.length}</b> ready to upload
            {parsed.dupes > 0 && <> · {parsed.dupes} duplicates inside the file removed</>}
            {parsed.invalid.length > 0 && <> · <span className="warn">{parsed.invalid.length} rows with problems</span></>}
          </div>
          {parsed.ignored.length > 0 && <div className="hint">Ignored columns: {parsed.ignored.join(", ")}</div>}
          {parsed.valid.slice(0, 4).map((r, i) => (
            <div key={i} className="preview-row">{r.full_name} · {r.email || r.linkedin_url || r.phone}</div>
          ))}
          {parsed.invalid.slice(0, 3).map((r, i) => (
            <div key={i} className="preview-row warn">Row {r.line}: {r.reason}</div>
          ))}
        </div>
      )}

      {error && <div className="msg error">{error}</div>}
      <div className="row-end">
        <button className="primary" disabled={busy || !parsed?.valid.length} onClick={submit}>
          {busy ? "Uploading…" : `Upload ${parsed?.valid.length ?? 0} candidates`}
        </button>
      </div>
    </div>
  );
}
