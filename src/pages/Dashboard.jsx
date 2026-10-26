import { useAuth } from "../auth/AuthContext";
import { ROLES } from "../lib/roles";

const MODULES = [
  { key: "candidates.manage", title: "Candidates", desc: "Sourcing, screening and pipeline" },
  { key: "jobs.manage", title: "Jobs & Requisitions", desc: "Open reqs and JD management" },
  { key: "outreach.manage", title: "Outreach", desc: "LinkedIn and email campaigns" },
  { key: "clients.manage", title: "Clients", desc: "Client accounts and contacts" },
  { key: "reports.view", title: "Reports", desc: "Recruiting performance" },
  { key: "finance.view", title: "Finance", desc: "Invoicing and payments" },
  { key: "users.view", title: "Team & Access", desc: "Who has access to what" },
];

export default function Dashboard() {
  const { profile, role, can, signOut } = useAuth();
  const visible = MODULES.filter((m) => can(m.key));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Chiparama</div>
        <div className="who">
          <span>{profile.full_name || profile.email}</span>
          <span className="badge">{ROLES[role]?.label}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>
        <h1>Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
        <div className="grid">
          {visible.map((m) => (
            <div key={m.key} className="tile">
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
