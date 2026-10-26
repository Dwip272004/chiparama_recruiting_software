import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLES } from "../lib/roles";
import "../jobs.css";

const NAV = [
  { to: "/", label: "Dashboard", perm: "dashboard.view", end: true },
  { to: "/jobs", label: "Jobs", perm: "jobs.view" },
  { to: "/calling", label: "Calling list", perm: "calling.view" },
];

export default function Layout() {
  const { profile, role, can, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Chiparama</div>
        <nav>
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who-name">{profile.full_name || profile.email}</div>
          <span className="badge">{ROLES[role]?.label}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
