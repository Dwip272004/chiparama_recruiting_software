import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ permission, children }) {
  const { session, profile, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <div className="center-screen">Loading…</div>;
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location }} />;
  if (permission && !can(permission)) {
    return (
      <div className="center-screen">
        <h2>Access denied</h2>
        <p>Your role doesn't have permission to view this page.</p>
      </div>
    );
  }
  return children;
}
