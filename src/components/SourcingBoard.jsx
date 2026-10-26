import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { pct } from "../lib/dashboard";
import { CHANNELS } from "../lib/outreach";
import { fmtDateTime } from "../lib/outreach";

function Spark({ points }) {
  const w = 96, h = 30, pad = 3;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${d} L${last[0]},${h - pad} L${xy[0][0]},${h - pad} Z`} className="spark-fill" />
      <path d={d} className="spark-line" fill="none" />
      <circle cx={last[0]} cy={last[1]} r="2.6" className="spark-dot" />
    </svg>
  );
}

// Cumulative totals after each lot, starting from 0.
const series = (lots) => lots.reduce((acc, l) => [...acc, acc[acc.length - 1] + l.added], [0]);

function Delta({ n, label }) {
  if (!n) return <span className="delta flat">– no new</span>;
  return <span className="delta up">▲ +{n}{label ? ` ${label}` : ""}</span>;
}

function Equation({ lots, total }) {
  if (lots.length === 0) return <span className="muted small">No lots yet</span>;
  const shown = lots.slice(-6);
  // candidates added outside a tagged lot (e.g. one by one) count as earlier ones
  const hidden = total - shown.reduce((n, l) => n + l.added, 0);
  return (
    <span className="eq">
      {hidden > 0 && <><span className="eq-chip old" title="Earlier lots">{hidden}</span><span className="eq-op">+</span></>}
      {shown.map((l, i) => (
        <span key={l.id} className="eq-part">
          {i > 0 && <span className="eq-op">+</span>}
          <span className={`eq-chip ${i === shown.length - 1 && lots.length > 1 ? "new" : "old"}`} title={`${l.tag} · ${fmtDateTime(l.at)}${l.by ? ` · ${l.by}` : ""}`}>{l.added}</span>
        </span>
      ))}
      <span className="eq-op">=</span>
      <b className="eq-total">{total}</b>
    </span>
  );
}

function ChannelCell({ c, total }) {
  const t = c?.touched ?? 0;
  return (
    <div className="ch-cell">
      <div className="ch-top"><b>{t}</b><span className="muted small"> / {total}</span></div>
      <div className="progress"><i style={{ width: `${pct(t, total)}%` }} /></div>
      <div className="small ch-sub">
        <span className="muted">replied</span> <b>{c?.replied ?? 0}</b> · <span className="muted">interested</span> <b className="pos">{c?.interested ?? 0}</b>
      </div>
    </div>
  );
}

export default function SourcingBoard({ jobs }) {
  const navigate = useNavigate();
  const rows = useMemo(
    () => jobs.map((j) => {
      const last = j.lots[j.lots.length - 1];
      return { ...j, last, before: last ? j.total - last.added : j.total, spark: series(j.lots) };
    }),
    [jobs]
  );
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);

  if (rows.length === 0) return <div className="empty small">No candidates sourced yet. Upload a lot from a job's candidates page.</div>;

  return (
    <div className="sourcing">
      <div className="ticker-head">
        <div><span className="muted small">Total in pipelines</span><div className="ticker-total">{sum("total")} <Delta n={sum("added_today")} label="today" /></div></div>
        <div className="muted small">Last 7 days: <b className="pos">+{sum("added_7d")}</b> candidates added</div>
      </div>

      <div className="ticker" role="list">
        {rows.map((r) => (
          <button key={r.id} role="listitem" className="tick" onClick={() => navigate(`/jobs/${r.job_code}/candidates`)}>
            <div className="tick-top">
              <span className="mono tick-code">{r.job_code}</span>
              <span className="muted small tick-client">{r.client_name ?? ""}</span>
            </div>
            <div className="tick-mid">
              <span className="tick-total">{r.total}</span>
              <Spark points={r.spark} />
            </div>
            <div className="tick-bot">
              {r.last ? <Delta n={r.last.added} /> : <span className="delta flat">–</span>}
              <span className="muted small">{r.last && r.lots.length > 1 ? `${r.before} existing + ${r.last.added} new` : r.last ? `${r.last.added} in first lot` : ""}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="list sourcing-table">
          <thead>
            <tr>
              <th>Job</th><th>Candidates added (lot by lot)</th>
              {CHANNELS.map((c) => (<th key={c.key}>{c.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/jobs/${r.job_code}/candidates`)}>
                <td>
                  <div><span className="mono">{r.job_code}</span> <b>{r.title}</b></div>
                  <div className="muted small">{r.client_name ?? "—"} · {r.status.replace(/_/g, " ")}</div>
                </td>
                <td>
                  <Equation lots={r.lots} total={r.total} />
                  <div className="small"><Delta n={r.added_today} label="today" /> <span className="muted">· {r.added_7d} in 7 days</span></div>
                </td>
                {CHANNELS.map((c) => (<td key={c.key}><ChannelCell c={r.channels[c.key]} total={r.total} /></td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
