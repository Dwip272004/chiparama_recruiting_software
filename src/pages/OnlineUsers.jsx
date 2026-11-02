import { useEffect, useState } from "react";
import { watchPresence, fetchPresenceSummary } from "../lib/presence";
import { ROLES } from "../lib/roles";
import { fmtDateTime } from "../lib/outreach";
import "../outreach.css";

const PAGE_LABEL = {
  list: "On the calling list", call: "On a call screen", dashboard: "Dashboard", jobs: "Jobs", positions: "Open positions",
  email: "Email outreach", inmails: "InMails", feedback: "Feedback", online: "Online now",
};
const dur = (secs) => {
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const isCalling = (u) => u.page === "list" || u.page === "call";

const ago = (t, now) => {
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function OnlineUsers() {
  const [users, setUsers] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState([]);
  const [sumError, setSumError] = useState("");
  const sorted = [...users].sort((a, b) => Number(isCalling(b)) - Number(isCalling(a)) || a.name.localeCompare(b.name));
  const calling = users.filter(isCalling).length;

  useEffect(() => watchPresence(setUsers), []);
  useEffect(() => {
    const load = () => fetchPresenceSummary().then((d) => { setSummary(d); setSumError(""); }).catch((e) => setSumError(e.message));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const todayOf = (id) => summary.find((s) => s.user_id === id)?.today_secs;
  const onlineIds = new Set(users.map((u) => u.id));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Online now</h1>
          <div className="muted">Everyone signed in right now, admins included. People using the calling tool are listed first. Updates live.</div>
        </div>
        <span className="tag good">{users.length} online · {calling} calling</span>
      </div>
      {users.length === 0 ? (
        <div className="empty">Nobody is online right now.</div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Person</th><th>Role</th><th>Where</th><th>Working on</th><th>This visit</th><th>Today</th></tr></thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id}>
                  <td><span className="dot" style={{ background: "var(--green-fg, #22c55e)" }} /> <b>{u.name}</b>{u.tabs > 1 && <span className="muted small"> · {u.tabs} tabs</span>}</td>
                  <td className="small">{ROLES[u.role]?.label ?? u.role}</td>
                  <td className="small">{PAGE_LABEL[u.page] ?? u.page}</td>
                  <td className="small">{u.detail || <span className="muted">—</span>}</td>
                  <td className="muted small">{ago(u.since, now)}</td>
                  <td className="small">{todayOf(u.id) != null ? dur(todayOf(u.id)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Time online</h2>
      <div className="muted small" style={{ marginBottom: 10 }}>Recorded while the app is open. "Today" resets at midnight in your timezone.</div>
      {sumError ? (
        <div className="msg error">Couldn't load recorded time: {sumError}. Make sure migration 016_presence_sessions.sql has been run in Supabase.</div>
      ) : summary.length === 0 ? (
        <div className="empty small">No time recorded yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Person</th><th>Role</th><th>Today</th><th>Last 7 days</th><th>All time</th><th>Last seen</th></tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.user_id}>
                  <td><span className="dot" style={{ background: onlineIds.has(s.user_id) ? "var(--green-fg, #22c55e)" : "var(--muted, #9ca3af)" }} /> <b>{s.full_name ?? "—"}</b></td>
                  <td className="small">{ROLES[s.role]?.label ?? s.role}</td>
                  <td>{dur(s.today_secs)}</td>
                  <td>{dur(s.week_secs)}</td>
                  <td>{dur(s.total_secs)}</td>
                  <td className="muted small">{onlineIds.has(s.user_id) ? "Online now" : fmtDateTime(s.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
