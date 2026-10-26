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
    "candidates.manage",
    "jobs.manage",
    "clients.manage",
    "outreach.manage",
    "reports.view",
    "users.view",
    "finance.view",
  ],
  recruiting_manager: [
    "dashboard.view",
    "candidates.manage",
    "jobs.manage",
    "outreach.manage",
    "reports.view",
  ],
};

export function can(role, permission) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes("*") || list.includes(permission);
}
