import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLES } from "../lib/roles";
import TopBar from "./TopBar";
import { GridIcon, BriefcaseIcon, PhoneIcon, LogoutIcon, SendIcon, ChatIcon, MailIcon } from "./Icons";
import { fetchInmailPendingCount } from "../lib/inmail";
import { fetchNewFeedbackCount } from "../lib/feedback";
import "../jobs.css";
import "../layout.css";

const NAV = [
  { to: "/", label: "Dashboard", perm: "dashboard.view", end: true, Icon: GridIcon },
  { to: "/jobs", label: "Jobs", perm: "jobs.view", Icon: BriefcaseIcon },
  { to: "/calling", label: "Calling list", perm: "calling.view", Icon: PhoneIcon },
  { to: "/email", label: "Email outreach", perm: "email.manage", Icon: MailIcon },
  { to: "/inmails", label: "InMails", perm: "inmail.view", Icon: SendIcon, badge: "inmail" },
  { to: "/feedback", label: "Feedback", perm: "feedback.submit", Icon: ChatIcon, badge: "feedback" },
];

export default function Layout() {
  const { profile, role, can, signOut } = useAuth();
  const [inmailWaiting, setInmailWaiting] = useState(0);
  const [fbNew, setFbNew] = useState(0);
  useEffect(() => {
    if (!can("feedback.manage")) return;
    const load = () => fetchNewFeedbackCount().then(setFbNew).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [can]);
  useEffect(() => {
    if (!can("inmail.send")) return;
    const load = () => fetchInmailPendingCount().then(setInmailWaiting).catch(() => {});
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [can]);
  return (
    <div className="shell" data-role={role}>
      <aside className="sidebar">
        <div className="brand">Chiparama</div>
        <nav>
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <n.Icon /> {n.label}
              {n.badge === "inmail" && inmailWaiting > 0 && <span className="nav-badge">{inmailWaiting}</span>}
              {n.badge === "feedback" && fbNew > 0 && <span className="nav-badge">{fbNew}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who-name">{profile.full_name || profile.email}</div>
          <span className="badge role-badge">{ROLES[role]?.label}</span>
          <button className="link signout" onClick={signOut}><LogoutIcon width={15} height={15} /> Sign out</button>
        </div>
      </aside>
      <div className="main-col">
        <TopBar />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
