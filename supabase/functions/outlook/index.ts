// Outlook (Microsoft Graph) mailer. Only Dwip (super_admin) can call it.
// Actions: status | start | send_next | test
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CID = Deno.env.get("MS_CLIENT_ID");
const SECRET = Deno.env.get("MS_CLIENT_SECRET");
const TENANT = Deno.env.get("MS_TENANT") || "common";
const SCOPES = "offline_access User.Read Mail.Send";
const REDIRECT = `${URL_}/functions/v1/outlook-callback`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const configured = () => !!CID && !!SECRET;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function vars(c: Record<string, string | null>) {
  const full = (c.full_name ?? c.to_name ?? "").trim();
  return {
    first_name: cap(full.split(/\s+/)[0] || "there"),
    full_name: full,
    company: c.company ?? "",
    title: c.title ?? "",
    job_title: c.job_title ?? "",
    client: c.client ?? "",
    location: c.location ?? "",
  } as Record<string, string>;
}
const fill = (t: string, v: Record<string, string>, html: boolean) =>
  t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in v ? (html ? esc(v[k]) : v[k]) : ""));
const toHtml = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.split("\n").join("<br>")}</p>`).join("");

async function tokenFor(admin: ReturnType<typeof createClient>, accountId: string, userId: string, force = false) {
  const { data: acc } = await admin.from("mail_accounts").select("id,user_id,email,status").eq("id", accountId).maybeSingle();
  if (!acc || acc.user_id !== userId) throw new Error("Mailbox not found");
  if (acc.status !== "connected") throw Object.assign(new Error("Reconnect your Outlook mailbox"), { code: "reconnect" });
  const { data: tok } = await admin.from("mail_tokens").select("*").eq("account_id", accountId).maybeSingle();
  if (!tok) throw Object.assign(new Error("Reconnect your Outlook mailbox"), { code: "reconnect" });
  if (!force && new Date(tok.expires_at).getTime() - Date.now() > 120_000) return { token: tok.access_token as string, email: acc.email as string };

  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CID!, client_secret: SECRET!, grant_type: "refresh_token",
      refresh_token: tok.refresh_token, scope: SCOPES,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant" || res.status === 400 || res.status === 401) {
      await admin.from("mail_accounts").update({ status: "needs_reconnect" }).eq("id", accountId);
      throw Object.assign(new Error("Outlook sign-in expired. Reconnect your mailbox."), { code: "reconnect" });
    }
    throw new Error(`Token refresh failed (${res.status})`);
  }
  await admin.from("mail_tokens").update({
    access_token: body.access_token,
    refresh_token: body.refresh_token || tok.refresh_token,
    expires_at: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("account_id", accountId);
  return { token: body.access_token as string, email: acc.email as string };
}

async function graphSend(token: string, to: string, toName: string | null, subject: string, html: string) {
  return await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to, ...(toName ? { name: toName } : {}) } }],
      },
      saveToSentItems: true,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const admin = createClient(URL_, SERVICE);
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: role } = await user.rpc("current_app_role");
    if (role !== "super_admin") return json({ error: "Only Dwip can use email outreach" }, 403);

    const input = await req.json().catch(() => ({}));
    const action = input.action as string;

    if (action === "status") return json({ configured: configured(), redirect_uri: REDIRECT });

    if (action === "start") {
      if (!configured()) return json({ error: "not_configured", redirect_uri: REDIRECT });
      const state = crypto.randomUUID();
      const returnTo = typeof input.return_to === "string" && /^https?:\/\//.test(input.return_to) ? input.return_to : null;
      await admin.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
      const { error } = await admin.from("oauth_states").insert({ state, user_id: u.user.id, return_to: returnTo });
      if (error) throw error;
      const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?` + new URLSearchParams({
        client_id: CID!, response_type: "code", redirect_uri: REDIRECT, response_mode: "query",
        scope: SCOPES, state, prompt: "select_account",
      });
      return json({ url });
    }

    if (action === "test") {
      const { account_id, subject, body } = input;
      const { token, email } = await tokenFor(admin, account_id, u.user.id);
      const v = vars({ full_name: "Alex Sample", company: "Sample Corp", title: "Engineer", job_title: "Your role", client: "Client", location: "Remote", to_name: null });
      const res = await graphSend(token, email, null, "[TEST] " + fill(subject ?? "", v, false), toHtml(fill(body ?? "", v, true)));
      if (res.status !== 202) return json({ error: `Outlook rejected the test (${res.status}): ${(await res.text()).slice(0, 200)}` }, 502);
      return json({ ok: true, sent_to: email });
    }

    if (action === "send_next") {
      const { campaign_id, lot_no } = input;
      const { data: claim, error: ce } = await user.rpc("claim_next_email", { p_campaign_id: campaign_id, p_lot_no: lot_no });
      if (ce) return json({ error: ce.message }, 400);
      if (!claim) return json({ done: true });

      const finish = async (ok: boolean, err?: string) =>
        await user.rpc("finish_email", { p_send_id: claim.send_id, p_ok: ok, p_error: err ?? null });
      const requeue = async () => await admin.from("email_sends").update({ status: "queued" }).eq("id", claim.send_id);

      try {
        const v = vars(claim);
        const subject = fill(claim.subject, v, false);
        const html = toHtml(fill(claim.body, v, true));
        let { token } = await tokenFor(admin, claim.account_id, u.user.id);
        let res = await graphSend(token, claim.to_email, claim.to_name, subject, html);
        if (res.status === 401) {
          ({ token } = await tokenFor(admin, claim.account_id, u.user.id, true));
          res = await graphSend(token, claim.to_email, claim.to_name, subject, html);
        }
        if (res.status === 202) {
          await finish(true);
          return json({ sent: true, to: claim.to_email, name: claim.full_name, left_in_lot: claim.left_in_lot });
        }
        if (res.status === 429 || res.status >= 500) {
          await requeue();
          return json({ retry: true, retry_after: Number(res.headers.get("Retry-After") ?? 60), error: `Outlook is throttling (${res.status})` });
        }
        const text = (await res.text()).slice(0, 300);
        await finish(false, `Outlook ${res.status}: ${text}`);
        return json({ sent: false, to: claim.to_email, name: claim.full_name, left_in_lot: claim.left_in_lot, error: `Outlook ${res.status}` });
      } catch (e) {
        if ((e as { code?: string }).code === "reconnect") {
          await requeue();
          return json({ error: (e as Error).message, reconnect: true }, 409);
        }
        await finish(false, (e as Error).message);
        return json({ sent: false, to: claim.to_email, name: claim.full_name, left_in_lot: claim.left_in_lot, error: (e as Error).message });
      }
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
