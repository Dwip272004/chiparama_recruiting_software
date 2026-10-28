import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import Drawer from "../components/Drawer";
import { timeAgo } from "../lib/dashboard";
import {
  POS_STATUSES, PRIORITIES, EMPLOYMENT, WORK_MODES, prioMeta, statusMeta, fetchPositions, fetchPositionLog,
  canEditPositions, savePosition, removePosition, restorePosition, setPriority, fmtDate, fmtDateTime, daysOpen,
} from "../lib/positions";
import "../positions.css";

const Pill = ({ tone, children }) => <span className={`status status-${tone}`}>{children}</span>;
const EMPTY = { title: "", location: "", employment: "Contract", work_mode: "", client: "", bill_rate: "", description: "", status: "open", priority: "normal" };

const LABELS = { title: "Title", location: "Location", employment: "Type", work_mode: "Work mode", client: "Client", bill_rate: "Bill rate", description: "Description", status: "Status", priority: "Priority" };
const show = (f, v) => (v === null || v === undefined || v === "" ? "—" : f === "status" ? statusMeta(v).label : f === "priority" ? prioMeta(v).label : String(v));

function History({ log }) {
  if (!log) return <div className="muted small">Loading history…</div>;
  return (
    <ul className="pos-log">
      {log.map((l) => (
        <li key={l.id} className={`act-${l.action}`}>
          <div className="pos-log-head">
            <b>{{ added: "Added", edited: "Edited", removed: "Removed", restored: "Restored", priority: "Priority changed" }[l.action]}</b>
            <span className="muted small"> · {l.actor_name ?? "System"} · {fmtDateTime(l.created_at)}</span>
          </div>
          {Object.entries(l.changes ?? {}).map(([f, [a, b]]) => (
            <div key={f} className="muted small">{LABELS[f] ?? f}: {f === "description" ? "updated" : <>{show(f, a)} → <b>{show(f, b)}</b></>}</div>
          ))}
          {l.note && <div className="small pos-note">“{l.note}”</div>}
        </li>
      ))}
    </ul>
  );
}

function Detail({ p, canEdit, isAdmin, onClose, onChanged, onEdit }) {
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");

  const loadLog = useCallback(() => fetchPositionLog(p.id).then(setLog).catch((e) => setErr(e.message)), [p.id]);
  useEffect(() => { setLog(null); loadLog(); }, [loadLog, p.updated_at]);

  const run = async (fn) => {
    setBusy(true); setErr("");
    try { await fn(); await onChanged(); await loadLog(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const pm = prioMeta(p.priority);
  const removed = !!p.removed_at;

  return (
    <div className="pos-detail">
      {err && <div className="msg error">{err}</div>}
      <div className="pos-badges">
        <Pill tone={removed ? "red" : statusMeta(p.status).color}>{removed ? "Removed" : statusMeta(p.status).label}</Pill>
        {p.priority !== "normal" && <Pill tone={pm.color}>{pm.label} priority</Pill>}
      </div>
      <dl className="pos-facts">
        <div><dt>Client</dt><dd>{p.client ?? "—"}</dd></div>
        <div><dt>Location</dt><dd>{p.location ?? "—"}</dd></div>
        <div><dt>Type</dt><dd>{p.employment ?? "—"}</dd></div>
        <div><dt>Work mode</dt><dd>{p.work_mode ?? "—"}</dd></div>
        <div><dt>Bill rate</dt><dd>{p.bill_rate ?? "—"}</dd></div>
        <div><dt>Open for</dt><dd>{daysOpen(p)} days</dd></div>
        <div><dt>Date added</dt><dd>{fmtDate(p.added_at)}<span className="muted small"> · {p.added_by_name ?? "—"}</span></dd></div>
        <div><dt>Date removed</dt><dd>{removed ? <>{fmtDate(p.removed_at)}<span className="muted small"> · {p.removed_by_name}</span></> : "—"}</dd></div>
      </dl>
      {removed && p.removed_reason && <div className="msg info">Removal reason: {p.removed_reason}</div>}

      <h4>Job description</h4>
      {p.description ? <div className="pre pos-jd">{p.description}</div> : <div className="muted small">No description added yet.</div>}

      {isAdmin && !removed && (
        <section className="pos-box">
          <h4>Priority <span className="muted small">(admins only)</span></h4>
          <div className="pos-prio-row">
            {PRIORITIES.map((x) => (
              <button key={x.key} type="button" disabled={busy} className={`chip tone-chip c-${x.color} ${p.priority === x.key ? "on" : ""}`}
                onClick={() => p.priority !== x.key && run(async () => { await setPriority(p.id, x.key, note); setNote(""); })}>{x.label}</button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the change (e.g. client escalated)" />
          {p.priority_updated_at && <div className="muted small">Last changed {timeAgo(p.priority_updated_at)} by {p.priority_updated_by_name}</div>}
        </section>
      )}

      {canEdit && (
        <div className="pos-actions">
          {!removed && <button className="ghost" onClick={() => onEdit(p)}>Edit</button>}
          {!removed && !removing && <button className="ghost danger" onClick={() => setRemoving(true)}>Remove</button>}
          {removed && <button className="primary" disabled={busy} onClick={() => run(() => restorePosition(p.id))}>Restore position</button>}
        </div>
      )}
      {removing && (
        <section className="pos-box">
          <label>Reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Filled, on hold, client cancelled…" autoFocus />
          </label>
          <div className="pos-actions">
            <button className="primary" disabled={busy} onClick={() => run(async () => { await removePosition(p.id, reason); setRemoving(false); setReason(""); })}>Confirm remove</button>
            <button className="ghost" onClick={() => setRemoving(false)}>Cancel</button>
          </div>
        </section>
      )}

      <h4>History</h4>
      <History log={log} />
    </div>
  );
}

function Form({ initial, isAdmin, onSaved, onCancel }) {
  const [f, setF] = useState({ ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ""])) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { const id = await savePosition(initial?.id, f); await onSaved(id); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="pos-form" onSubmit={submit}>
      {err && <div className="msg error">{err}</div>}
      <label>Position title *<input value={f.title} onChange={set("title")} required autoFocus /></label>
      <div className="two-col">
        <label>Client<input value={f.client} onChange={set("client")} /></label>
        <label>Location<input value={f.location} onChange={set("location")} /></label>
      </div>
      <div className="two-col">
        <label>Contract / Full time
          <select value={f.employment} onChange={set("employment")}><option value="">—</option>{EMPLOYMENT.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label>Onsite / Remote / Hybrid
          <select value={f.work_mode} onChange={set("work_mode")}><option value="">Not specified</option>{WORK_MODES.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
      </div>
      <div className="two-col">
        <label>Bill rate<input value={f.bill_rate} onChange={set("bill_rate")} placeholder="$60/hr all-inc" /></label>
        <label>Status
          <select value={f.status} onChange={set("status")}>{POS_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </label>
      </div>
      {isAdmin && !initial?.id && (
        <label>Priority
          <select value={f.priority} onChange={set("priority")}>{PRIORITIES.slice().reverse().map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </label>
      )}
      <label>Job description<textarea rows={9} value={f.description} onChange={set("description")} placeholder="One requirement per line works well." /></label>
      <div className="pos-actions">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Save changes" : "Add position"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Positions() {
  const { can } = useAuth();
  const isAdmin = can("positions.priority");
  const [rows, setRows] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("active");
  const [q, setQ] = useState("");
  const [client, setClient] = useState("");
  const [prio, setPrio] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState(null); // selected id
  const [form, setForm] = useState(null); // null | {} (new) | position

  const load = useCallback(async () => {
    try { setRows(await fetchPositions()); setError(""); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); canEditPositions().then(setCanEdit); }, [load]);

  const clientName = (c) => (c ?? "—").replace(/\s*\(via HCL\)/, "");
  const active = useMemo(() => (rows ?? []).filter((r) => !r.removed_at), [rows]);
  const removed = useMemo(() => (rows ?? []).filter((r) => r.removed_at), [rows]);
  const clients = useMemo(() => [...new Set((rows ?? []).map((r) => clientName(r.client)))].sort(), [rows]);
  const weekAgo = Date.now() - 7 * 86400000;
  const addedWeek = (rows ?? []).filter((r) => new Date(r.added_at).getTime() > weekAgo && r.added_by_name !== "Imported").length;
  const removedWeek = removed.filter((r) => new Date(r.removed_at).getTime() > weekAgo).length;

  const list = useMemo(() => {
    const base = tab === "active" ? active : removed;
    const s = q.trim().toLowerCase();
    return base
      .filter((r) => (!client || clientName(r.client) === client) && (!prio || r.priority === prio) && (!status || r.status === status)
        && (!s || [r.title, r.client, r.location, r.description].some((x) => (x ?? "").toLowerCase().includes(s))))
      .sort((a, b) => tab === "removed" ? new Date(b.removed_at) - new Date(a.removed_at)
        : prioMeta(a.priority).rank - prioMeta(b.priority).rank || new Date(b.added_at) - new Date(a.added_at));
  }, [tab, active, removed, q, client, prio, status]);

  const selected = (rows ?? []).find((r) => r.id === sel);
  if (error && !rows) return <div className="msg error">{error}</div>;
  if (!rows) return <div className="empty">Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Open positions</h1>
          <div className="muted small">Live list of what we're hiring for. {canEdit ? "You can add, edit and remove positions." : "View only."}{isAdmin ? " Priority is managed by admins." : ""}</div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={load}>Refresh</button>
          {canEdit && <button className="primary" onClick={() => setForm({})}>+ Add position</button>}
        </div>
      </div>
      {error && <div className="msg error">{error}</div>}

      <div className="kpis">
        <div className="kpi t-blue"><div className="num">{active.length}</div><div className="lbl">Open positions</div></div>
        <div className={`kpi ${active.some((r) => r.priority !== "normal") ? "alert" : ""}`}><div className="num">{active.filter((r) => r.priority !== "normal").length}</div><div className="lbl">Priority positions</div></div>
        <div className="kpi good"><div className="num">+{addedWeek}</div><div className="lbl">Added in last 7 days</div></div>
        <div className="kpi t-orange"><div className="num">−{removedWeek}</div><div className="lbl">Removed in last 7 days</div></div>
        <div className="kpi t-purple"><div className="num">{new Set(active.map((r) => clientName(r.client))).size}</div><div className="lbl">Clients</div></div>
      </div>

      <div className="filters pos-filters">
        <button className={`chip ${tab === "active" ? "on" : ""}`} onClick={() => setTab("active")}>Open <span>{active.length}</span></button>
        <button className={`chip ${tab === "removed" ? "on" : ""}`} onClick={() => setTab("removed")}>Removed <span>{removed.length}</span></button>
        <input className="pos-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, client, location, description…" />
        <select value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{clients.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{POS_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
      </div>

      <div className="table-wrap">
        <table className="list pos-table">
          <thead>
            <tr><th>Position</th><th>Client</th><th>Location</th><th>Type</th><th>Bill rate</th><th>Priority</th><th>Status</th><th>Added</th>{tab === "removed" && <th>Removed</th>}</tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="empty small">{tab === "removed" ? "Nothing removed yet." : "No positions match."}</td></tr>}
            {list.map((r) => {
              const pm = prioMeta(r.priority);
              return (
                <tr key={r.id} onClick={() => setSel(r.id)} className={r.priority !== "normal" ? `prio-row prio-${r.priority}` : ""}>
                  <td><span className="cname">{r.title}</span></td>
                  <td>{clientName(r.client)}</td>
                  <td className="muted">{r.location ?? "—"}</td>
                  <td className="muted">{[r.employment, r.work_mode].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{r.bill_rate ?? "—"}</td>
                  <td>{r.priority === "normal" ? <span className="muted">—</span> : <Pill tone={pm.color}>{pm.label}</Pill>}</td>
                  <td><Pill tone={statusMeta(r.status).color}>{statusMeta(r.status).label}</Pill></td>
                  <td className="muted">{fmtDate(r.added_at)}</td>
                  {tab === "removed" && <td className="muted">{fmtDate(r.removed_at)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer open={!!selected && !form} onClose={() => setSel(null)} title={selected?.title ?? ""} subtitle={selected ? clientName(selected.client) : ""}>
        {selected && <Detail p={selected} canEdit={canEdit} isAdmin={isAdmin} onClose={() => setSel(null)} onChanged={load} onEdit={(p) => setForm(p)} />}
      </Drawer>
      <Drawer open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit position" : "Add position"} width={560}>
        {form && <Form initial={form.id ? form : null} isAdmin={isAdmin}
          onSaved={async (id) => { await load(); setForm(null); setSel(id); }} onCancel={() => setForm(null)} />}
      </Drawer>
    </div>
  );
}
