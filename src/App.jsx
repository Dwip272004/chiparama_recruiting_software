import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import JobCandidates from "./pages/JobCandidates";
import CallingList from "./pages/CallingList";
import CallProfile from "./pages/CallProfile";
import Inmails from "./pages/Inmails";
import Feedback from "./pages/Feedback";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <ProtectedRoute permission="dashboard.view">
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route
              path="/jobs/:jobCode/candidates"
              element={
                <ProtectedRoute permission="candidates.manage">
                  <JobCandidates />
                </ProtectedRoute>
              }
            />
            <Route
              path="/calling/:rowId"
              element={
                <ProtectedRoute permission="calling.view">
                  <CallProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/calling"
              element={
                <ProtectedRoute permission="calling.view">
                  <CallingList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/feedback"
              element={
                <ProtectedRoute permission="feedback.submit">
                  <Feedback />
                </ProtectedRoute>
              }
            />
            <Route
              path="/inmails"
              element={
                <ProtectedRoute permission="inmail.view">
                  <Inmails />
                </ProtectedRoute>
              }
            />
            <Route
              path="/jobs/:jobCode?"
              element={
                <ProtectedRoute permission="jobs.view">
                  <Jobs />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
