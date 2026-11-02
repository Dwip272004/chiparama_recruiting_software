import { useEffect, useState } from "react";
import { watchPresence } from "../lib/presence";
import { ROLES } from "../lib/roles";
import "../outreach.css";

const PAGE_LABEL = {
  list: "On the calling list", call: "On a call screen", dashboard: "Dashboard", jobs: "Jobs", positions: "Open positions",
  email: "Email outreach", inmails: "InMails", feedback: "Feedback", online: "Online now",
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
  const sorted = [...users].sort((a, b) => Number(isCalling(b)) - Number(isCalling(a)) || a.name.localeCompare(b.name));
  const calling = users.filter(isCalling).length;

  useEffect(() => watchPresence(setUsers), []);
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
            <thead><tr><th>Person</th><th>Role</th><th>Where</th><th>Working on</th><th>Online for</th></tr></thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id}>
                  <td><span className="dot" style={{ background: "var(--green-fg, #22c55e)" }} /> <b>{u.name}</b>{u.tabs > 1 && <span className="muted small"> · {u.tabs} tabs</span>}</td>
                  <td className="small">{ROLES[u.role]?.label ?? u.role}</td>
                  <td className="small">{PAGE_LABEL[u.page] ?? u.page}</td>
                  <td className="small">{u.detail || <span className="muted">—</span>}</td>
                  <td className="muted small">{ago(u.since, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
