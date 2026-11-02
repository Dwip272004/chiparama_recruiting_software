import { useEffect, useState } from "react";
import { watchPresence } from "../lib/presence";
import { ROLES } from "../lib/roles";
import "../outreach.css";

const PAGE_LABEL = { list: "On the calling list", call: "On a call screen" };

const ago = (t, now) => {
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function OnlineUsers() {
  const [users, setUsers] = useState([]);
  const [now, setNow] = useState(Date.now());

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
          <div className="muted">People currently on the calling pages. Updates live.</div>
        </div>
        <span className="tag good">{users.length} online</span>
      </div>
      {users.length === 0 ? (
        <div className="empty">Nobody is on the calling pages right now.</div>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Person</th><th>Role</th><th>Doing</th><th>Working on</th><th>Online for</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><span className="dot" style={{ background: "var(--green-fg, #22c55e)" }} /> <b>{u.name}</b>{u.tabs > 1 && <span className="muted small"> · {u.tabs} tabs</span>}</td>
                  <td className="small">{ROLES[u.role]?.label ?? u.role}</td>
                  <td className="small">{PAGE_LABEL[u.page] ?? "Calling"}</td>
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
