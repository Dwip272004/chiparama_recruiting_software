import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { session, profile, signIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || "/";

  const [mode, setMode] = useState("login"); // "login" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (session && profile) return <Navigate to={redirectTo} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "login") {
        await signIn(email.trim().toLowerCase(), password);
        navigate(redirectTo, { replace: true });
      } else {
        await resetPassword(email.trim().toLowerCase());
        setNotice("If that email is registered, a reset link is on its way.");
      }
    } catch (err) {
      setError(
        err.message === "Invalid login credentials" ? "Incorrect email or password." : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">Chiparama</div>
        <h1>{mode === "login" ? "Sign in" : "Reset password"}</h1>
        <p className="sub">
          {mode === "login"
            ? "Recruiting workspace. Access is by invitation only."
            : "Enter your work email and we'll send a reset link."}
        </p>

        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        {mode === "login" && (
          <label>
            Password
            <div className="pw-row">
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="link" onClick={() => setShowPw((v) => !v)}>
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        )}

        {error && <div className="msg error">{error}</div>}
        {notice && <div className="msg ok">{notice}</div>}

        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Send reset link"}
        </button>

        <button
          type="button"
          className="link center"
          onClick={() => {
            setMode(mode === "login" ? "forgot" : "login");
            setError("");
            setNotice("");
          }}
        >
          {mode === "login" ? "Forgot password?" : "Back to sign in"}
        </button>
      </form>
    </div>
  );
}
