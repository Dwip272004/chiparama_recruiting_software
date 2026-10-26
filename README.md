# Chiparama Recruiting Software

React + Vite + Supabase. Invite-only login with role-based access.

## Roles

| Person   | Role                 | Access                                   |
|----------|----------------------|------------------------------------------|
| Dwip     | `super_admin`        | Complete access (`*`)                    |
| Prashant | `admin`              | All modules except user/role management  |
| Deepak   | `recruiting_manager` | Candidates, jobs, outreach, reports      |
| Iti      | `recruiting_manager` | Candidates, jobs, outreach, reports      |

Permissions live in `src/lib/roles.js`. Gate a page with `<ProtectedRoute permission="x.y">` or a UI element with `can("x.y")` from `useAuth()`.

## Setup

1. `cp .env.example .env` and fill in your Supabase URL and anon key.
2. Edit the seed emails at the bottom of `supabase/migrations/001_auth_roles.sql`, then run it in the Supabase SQL editor.
3. In Supabase Auth settings, disable public signups. Create the four users (Auth > Users > Invite) using the same emails.
4. `npm install && npm run dev`
5. Add `http://localhost:5173/reset-password` (and your production URL) to Auth > URL Configuration > Redirect URLs.

## Security notes

- Roles are enforced in the database (RLS), not just the UI. The frontend checks are for UX only.
- Never put the service-role key in the frontend.
