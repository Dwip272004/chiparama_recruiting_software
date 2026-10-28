// Roles
//   super_admin        -> Dwip (complete access)
//   admin              -> Prashant
//   recruiting_manager -> Deepak, Iti
export const ROLES = {
  super_admin: { label: "Admin (Full Access)" },
  admin: { label: "Admin" },
  recruiting_manager: { label: "Recruiting Manager" },
};

// "*" = everything. Add new permission keys here as modules get built.
export const PERMISSIONS = {
  super_admin: ["*"],
  admin: [
    "dashboard.view",
    "jobs.view",
    "jobs.submit",
    "jobs.review", // structure JDs, change status, edit job details
    "jobs.statuses", // manage the list of statuses
    "candidates.manage", // upload lots, manage the 4 outreach channels
    "calling.view", // calling list (admins see every caller's list)
    "positions.view",
    "positions.priority", // only admins set position priority
    "feedback.submit", // feedback.manage is Dwip-only (via "*")
    "inmail.view",
    "inmail.request",
    "inmail.send", // only admins send (paid) LinkedIn InMails
    "clients.manage",
    "outreach.manage",
    "reports.view",
    "users.view",
    "finance.view",
  ],
  recruiting_manager: [
    "dashboard.view",
    "jobs.view",
    "jobs.submit",
    "calling.view", // recruiting managers only make calls
    "positions.view", // edit rights are granted per-user in the database
    "feedback.submit",
    "inmail.view",
    "inmail.request", // ask the admins to send InMails
    "reports.view",
  ],
};

export function can(role, permission) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes("*") || list.includes(permission);
}
