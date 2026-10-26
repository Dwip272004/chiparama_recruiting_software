import { useAuth } from "../auth/AuthContext";
import AdminDashboard from "./dashboards/AdminDashboard";
import ManagerDashboard from "./dashboards/ManagerDashboard";

// Each role gets its own dashboard.
export default function Dashboard() {
  const { role } = useAuth();
  return role === "admin" || role === "super_admin" ? <AdminDashboard /> : <ManagerDashboard />;
}
