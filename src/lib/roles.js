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
    "reports.view",
  ],
};

export function can(role, permission) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes("*") || list.includes(permission);
}
