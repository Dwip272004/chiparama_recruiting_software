// OAuth redirect target for "Connect Outlook". Deployed with verify_jwt = false;
// it authenticates the request via the one-time `state` row created by the signed-in user.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CID = Deno.env.get("MS_CLIENT_ID")!;
const SECRET = Deno.env.get("MS_CLIENT_SECRET")!;
const TENANT = Deno.env.get("MS_TENANT") || "common";
const SCOPES = "offline_access User.Read Mail.Send";
const REDIRECT = `${URL_}/functions/v1/outlook-callback`;

const back = (returnTo: string | null, q: Record<string, string>) => {
  const base = returnTo ?? "/";
  const sep = base.includes("?") ? "&" : "?";
  const loc = base + sep + new URLSearchParams(q).toString();
  return new Response(null, { status: 302, headers: { Location: loc } });
};
const page = (msg: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px"><h3>${msg}</h3><p>You can close this tab and try again from the app.</p>`, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (!state) return page("Missing state.");
  const admin = createClient(URL_, SERVICE);

  const { data: st } = await admin.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st) return page("This connect link expired or was already used.");
  await admin.from("oauth_states").delete().eq("state", state);
  if (Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return back(st.return_to, { mail: "error", reason: "expired" });
  if (err || !code) return back(st.return_to, { mail: "error", reason: (err ?? "cancelled").slice(0, 120) });

  const tr = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: SECRET, code, redirect_uri: REDIRECT, grant_type: "authorization_code", scope: SCOPES }),
  });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token || !tok.refresh_token) {
    return back(st.return_to, { mail: "error", reason: String(tok.error_description ?? tok.error ?? "token").split("\n")[0].slice(0, 120) });
  }
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json()).catch(() => ({}));
  const email = (me.mail || me.userPrincipalName || "").toLowerCase();
  if (!email) return back(st.return_to, { mail: "error", reason: "no_email" });

  const { data: acc, error: ae } = await admin.from("mail_accounts")
    .upsert({ user_id: st.user_id, email, display_name: me.displayName ?? null, status: "connected", connected_at: new Date().toISOString() }, { onConflict: "user_id,email" })
    .select("id").single();
  if (ae || !acc) return back(st.return_to, { mail: "error", reason: "save_failed" });
  await admin.from("mail_tokens").upsert({
    account_id: acc.id, access_token: tok.access_token, refresh_token: tok.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  });
  return back(st.return_to, { mail: "connected" });
});
