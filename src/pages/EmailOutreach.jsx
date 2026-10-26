import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchJobs } from "../lib/jobs";
import {
  MERGE_FIELDS, DEFAULT_BODY, mailStatus, startConnect, sendTest, sendNext, fetchAccounts, disconnectAccount,
  fetchBatches, lotPreview, createCampaign, cancelCampaign, fetchCampaigns, render, SAMPLE,
} from "../lib/email";
import { timeAgo } from "../lib/dashboard";
import "../outreach.css";

const wait = (ms, stopRef, onTick) =>
  new Promise((resolve) => {
    let left = Math.ceil(ms / 1000);
    onTick?.(left);
    const t = setInterval(() => {
      left--;
      onTick?.(left);
      if (left <= 0 || stopRef.current) { clearInterval(t); resolve(); }
    }, 1000);
  });

function SetupSteps({ redirectUri }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="setup">
      <div className="msg info">One-time setup needed before Outlook can be connected.</div>
      <ol>
        <li>In <b>Azure portal → App registrations → New registration</b>, name it "Chiparama Outreach". Supported accounts: <i>Any organizational directory and personal accounts</i> (or just your tenant).</li>
        <li>Under <b>Authentication → Add a platform → Web</b>, add this Redirect URI:
          <div className="copy-line"><code>{redirectUri}</code>
            <button type="button" className="ghost sm" onClick={() => { navigator.clipboard?.writeText(redirectUri); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button></div></li>
        <li>Under <b>API permissions → Microsoft Graph → Delegated</b>, add <code>Mail.Send</code>, <code>User.Read</code>, <code>offline_access</code>.</li>
        <li>Under <b>Certificates &amp; secrets</b>, create a client secret and copy its <b>Value</b>.</li>
        <li>In <b>Supabase → Edge Functions → Secrets</b>, add <code>MS_CLIENT_ID</code> (Application ID) and <code>MS_CLIENT_SECRET</code>. If you registered a single tenant, also add <code>MS_TENANT</code> (your Directory ID).</li>
        <li>Come back here and press <b>Check again</b>.</li>
      </ol>
    </div>
  );
}

export default function EmailOutreach() {
  const [params, setParams] = useSearchParams();
  const [flash, setFlash] = useState(null); // {type, text}
  const [setup, setSetup] = useState(null); // {configured, redirect_uri}
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [camps, setCamps] = useState([]);
  const [busy, setBusy] = useState("");

  // composer
  const [jobId, setJobId] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState("");
  const [preview, setPreview] = useState(null);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("Quick question about a {{job_title}} role");
  const [body, setBody] = useState(DEFAULT_BODY);
  const bodyRef = useRef(null);

  // sending run
  const stopRef = useRef(false);
  const [run, setRun] = useState(null); // {campaignId, lotNo, sent, failed, total, state, countdown, log[]}
  const [confirm, setConfirm] = useState(null); // {camp, lot}

  const loadAll = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([fetchAccounts(), fetchCampaigns()]);
      setAccounts(a); setCamps(c);
      setAccountId((cur) => cur || a.find((x) => x.status === "connected")?.id || "");
    } catch (e) { setFlash({ type: "error", text: e.message }); }
  }, []);

  useEffect(() => {
    mailStatus().then(setSetup).catch((e) => setFlash({ type: "error", text: e.message }));
    fetchJobs().then((j) => setJobs(j.filter((x) => x.status !== "pending_review"))).catch(() => {});
    loadAll();
    const m = params.get("mail");
    if (m === "connected") setFlash({ type: "ok", text: "Outlook mailbox connected." });
    if (m === "error") setFlash({ type: "error", text: `Couldn't connect Outlook: ${params.get("reason") ?? "unknown error"}` });
    if (m) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBatches([]); setBatchId(""); setPreview(null);
    if (!jobId) return;
    fetchBatches(jobId).then(setBatches).catch(() => {});
  }, [jobId]);
  useEffect(() => {
    setPreview(null);
    if (!jobId) return;
    lotPreview(jobId, batchId).then(setPreview).catch((e) => setFlash({ type: "error", text: e.message }));
  }, [jobId, batchId]);
  useEffect(() => {
    const j = jobs.find((x) => x.id === jobId);
    const b = batches.find((x) => x.id === batchId);
    if (j) setName(`${j.job_code} · ${b ? b.tag : "All candidates"}`);
  }, [jobId, batchId, jobs, batches]);

  useEffect(() => {
    if (!run || run.state !== "running") return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [run]);

  const job = jobs.find((j) => j.id === jobId);
  const vars = { ...SAMPLE, job_title: job?.title ?? "Senior Engineer", client: job?.client_name ?? "Client", location: job?.location ?? "Remote" };
  const connected = accounts.filter((a) => a.status === "connected");
  const lots = preview ? Math.ceil(preview.eligible / 20) : 0;

  const insertField = (k) => {
    const el = bodyRef.current;
    const tag = `{{${k}}}`;
    if (!el) return setBody((b) => b + tag);
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + tag + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); });
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const r = await startConnect();
      if (r.url) window.location.href = r.url;
      else if (r.error === "not_configured") { setSetup({ configured: false, redirect_uri: r.redirect_uri }); }
    } catch (e) { setFlash({ type: "error", text: e.message }); } finally { setBusy(""); }
  };
  const disconnect = async (id) => {
    try { await disconnectAccount(id); await loadAll(); setFlash({ type: "ok", text: "Mailbox disconnected." }); }
    catch (e) { setFlash({ type: "error", text: e.message }); }
  };
  const test = async () => {
    setBusy("test");
    try { const r = await sendTest(accountId, subject, body); setFlash({ type: "ok", text: `Test sent to ${r.sent_to}. Check your inbox.` }); }
    catch (e) { setFlash({ type: "error", text: e.message }); } finally { setBusy(""); }
  };
  const create = async () => {
    setBusy("create"); setFlash(null);
    try {
      const r = await createCampaign({ jobId, batchId, accountId, name, subject, body });
      setFlash({ type: "ok", text: `Campaign created: ${r.queued} emails in ${r.lots} lot${r.lots > 1 ? "s" : ""} of 20. Nothing is sent until you press "Send lot".` });
      await loadAll();
      lotPreview(jobId, batchId).then(setPreview).catch(() => {});
    } catch (e) { setFlash({ type: "error", text: e.message }); } finally { setBusy(""); }
  };

  const runLot = async (camp, lot) => {
    setConfirm(null);
    stopRef.current = false;
    const state = { campaignId: camp.id, lotNo: lot.lot_no, sent: 0, failed: 0, total: lot.queued, state: "running", countdown: 0, log: [] };
    setRun({ ...state });
    const upd = (p) => setRun((r) => (r ? { ...r, ...p } : r));
    try {
      for (;;) {
        if (stopRef.current) { upd({ state: "paused" }); break; }
        const res = await sendNext(camp.id, lot.lot_no);
        if (res.done) { upd({ state: "done" }); break; }
        if (res.retry) {
          upd({ log: [`Outlook is throttling. Waiting ${res.retry_after}s…`, ...state.log].slice(0, 30) });
          await wait(res.retry_after * 1000, stopRef, (n) => upd({ countdown: n }));
          continue;
        }
        if (res.sent) state.sent++; else state.failed++;
        state.log = [`${res.sent ? "✓ Sent" : "✗ Failed"} · ${res.name ?? res.to} <${res.to}>${res.error ? ` · ${res.error}` : ""}`, ...state.log].slice(0, 30);
        upd({ sent: state.sent, failed: state.failed, log: state.log });
        if (res.left_in_lot === 0) { upd({ state: "done" }); break; }
        await wait(20000 + Math.random() * 20000, stopRef, (n) => upd({ countdown: n }));
      }
    } catch (e) {
      upd({ state: "error", log: [`Stopped: ${e.message}`, ...state.log] });
      setFlash({ type: "error", text: e.message });
    }
    upd({ countdown: 0 });
    loadAll();
  };

  const cancel = async (c) => {
    try { await cancelCampaign(c.id); await loadAll(); } catch (e) { setFlash({ type: "error", text: e.message }); }
  };

  const totals = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let sentToday = 0, queued = 0, failed = 0;
    camps.forEach((c) => {
      queued += c.status === "active" ? c.tot.queued : 0;
      failed += c.tot.failed;
      c.sends.forEach((s) => { if (s.status === "sent" && s.sent_at && new Date(s.sent_at) >= today) sentToday++; });
    });
    return { sentToday, queued, failed };
  }, [camps]);

  const running = run?.state === "running";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Email outreach</h1>
          <div className="muted small">Pick a lot, write one email, and send it in batches of 20 from your Outlook mailbox.</div>
        </div>
      </div>
      {flash && <div className={`msg ${flash.type === "ok" ? "ok" : "error"}`} style={{ marginBottom: 14 }}>{flash.text}</div>}

      <div className="kpis">
        <div className="kpi t-teal"><div className="num">{totals.sentToday}</div><div className="lbl">Sent today (cap 150)</div></div>
        <div className="kpi t-blue"><div className="num">{totals.queued}</div><div className="lbl">Queued in active campaigns</div></div>
        <div className={`kpi ${totals.failed ? "alert" : ""}`}><div className="num">{totals.failed}</div><div className="lbl">Failed</div></div>
      </div>

      <section className="card mail-card">
        <div className="row-between">
          <h3>1 · Mailbox</h3>
          <button className="primary sm" onClick={connect} disabled={busy === "connect" || setup?.configured === false}>
            {busy === "connect" ? "Opening Microsoft…" : accounts.length ? "Connect another / reconnect" : "Connect Outlook"}
          </button>
        </div>
        {setup && !setup.configured && (
          <>
            <SetupSteps redirectUri={setup.redirect_uri} />
            <button className="ghost" onClick={() => mailStatus().then(setSetup)}>Check again</button>
          </>
        )}
        {accounts.length === 0 && setup?.configured && <div className="muted small">No mailbox connected yet. Press Connect Outlook and sign in with the account you want to send from.</div>}
        {accounts.map((a) => (
          <div className="acct" key={a.id}>
            <span className={`dot-live ${a.status === "connected" ? "on" : "off"}`} />
            <div className="acct-main"><b>{a.email}</b><div className="muted small">{a.display_name} · {a.status === "connected" ? `connected ${timeAgo(a.connected_at)}` : "needs reconnect"}</div></div>
            <button className="link danger small" onClick={() => disconnect(a.id)}>Disconnect</button>
          </div>
        ))}
      </section>

      <section className="card composer">
        <h3>2 · New campaign</h3>
        <div className="two-col">
          <label>Job
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Select a job…</option>
              {jobs.map((j) => (<option key={j.id} value={j.id}>{j.job_code} · {j.title ?? "Untitled"}</option>))}
            </select>
          </label>
          <label>Candidate lot
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!jobId}>
              <option value="">All candidates in this job</option>
              {batches.map((b) => (<option key={b.id} value={b.id}>{b.tag}</option>))}
            </select>
          </label>
        </div>
        {preview && (
          <div className="lot-preview">
            <span><b>{preview.total}</b> in lot</span>
            <span><b>{preview.with_email}</b> have an email</span>
            <span className="pos"><b>{preview.eligible}</b> ready to email → {lots} lot{lots === 1 ? "" : "s"} of 20</span>
            {preview.already_emailed > 0 && <span className="muted">{preview.already_emailed} already emailed (skipped)</span>}
          </div>
        )}
        <div className="two-col">
          <label>Send from
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {connected.length === 0 && <option value="">Connect a mailbox first</option>}
              {connected.map((a) => (<option key={a.id} value={a.id}>{a.email}</option>))}
            </select>
          </label>
          <label>Campaign name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <div>
          <div className="row-between"><span className="lbl-sm">Body</span>
            <span className="merge-row">{MERGE_FIELDS.map(([k, l]) => (<button type="button" key={k} className="chip sm" onClick={() => insertField(k)} title={`Insert {{${k}}}`}>+ {l}</button>))}</span>
          </div>
          <textarea ref={bodyRef} rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="email-preview">
          <div className="muted small">Preview (sample candidate)</div>
          <div className="pv-subject">{render(subject, vars)}</div>
          <div className="pv-body">{render(body, vars)}</div>
        </div>
        <div className="row-end gap">
          <button className="ghost" onClick={test} disabled={!accountId || !subject.trim() || !body.trim() || busy === "test"}>{busy === "test" ? "Sending…" : "Send test to my mailbox"}</button>
          <button className="primary" onClick={create} disabled={!jobId || !accountId || !preview?.eligible || busy === "create" || !subject.trim() || !body.trim()}>
            {busy === "create" ? "Creating…" : `Create campaign${preview?.eligible ? ` (${preview.eligible} emails)` : ""}`}
          </button>
        </div>
      </section>

      <h2 className="section-title">3 · Campaigns &amp; sending</h2>
      {camps.length === 0 ? <div className="empty small">No campaigns yet.</div> : camps.map((c) => {
        const next = c.lots.find((l) => l.queued > 0);
        const active = c.status === "active";
        return (
          <section className="card camp" key={c.id}>
            <div className="row-between camp-head">
              <div>
                <div><b>{c.name}</b> <span className={`status status-${c.status === "active" ? "blue" : c.status === "done" ? "green" : "gray"}`}>{c.status}</span></div>
                <div className="muted small">{c.job?.job_code} · from {c.account?.email} · “{c.subject}” · {timeAgo(c.created_at)}</div>
              </div>
              <div className="camp-actions">
                {active && next && <button className="primary sm" disabled={running} onClick={() => setConfirm({ camp: c, lot: next })}>Send next lot ({Math.min(next.queued, 20)})</button>}
                {active && <button className="ghost sm" disabled={running && run.campaignId === c.id} onClick={() => cancel(c)}>Cancel remaining</button>}
              </div>
            </div>
            <div className="progress"><i style={{ width: `${c.tot.total ? Math.round((c.tot.sent / c.tot.total) * 100) : 0}%` }} /></div>
            <div className="muted small">{c.tot.sent} sent · {c.tot.queued} queued · {c.tot.failed} failed{c.tot.skipped ? ` · ${c.tot.skipped} cancelled` : ""} of {c.tot.total}</div>
            <div className="lot-grid">
              {c.lots.map((l) => {
                const isRun = run?.campaignId === c.id && run.lotNo === l.lot_no && run.state === "running";
                return (
                  <div key={l.lot_no} className={`lot-cell ${l.queued === 0 ? "done" : ""} ${isRun ? "live" : ""}`}>
                    <div className="row-between"><b>Lot {l.lot_no}</b><span className="muted small">{l.total}</span></div>
                    <div className="small"><span className="pos">{l.sent} sent</span>{l.failed > 0 && <> · <span className="neg" title={l.errors.join("\n")}>{l.failed} failed</span></>}{l.queued > 0 && <> · {l.queued} queued</>}</div>
                    {active && l.queued > 0 && <button className="ghost sm" disabled={running} onClick={() => setConfirm({ camp: c, lot: l })}>Send lot {l.lot_no}</button>}
                  </div>
                );
              })}
            </div>
            {run?.campaignId === c.id && (
              <div className={`runner ${run.state}`}>
                <div className="row-between">
                  <b>{run.state === "running" ? `Sending lot ${run.lotNo}…` : run.state === "done" ? `Lot ${run.lotNo} finished` : run.state === "paused" ? "Paused" : "Stopped"}</b>
                  <span className="small">{run.sent + run.failed} / {run.total}{run.state === "running" && run.countdown > 0 ? ` · next in ${run.countdown}s` : ""}</span>
                </div>
                <div className="progress"><i style={{ width: `${run.total ? Math.round(((run.sent + run.failed) / run.total) * 100) : 0}%` }} /></div>
                {run.state === "running" && <button className="ghost sm" onClick={() => { stopRef.current = true; }}>Pause after current email</button>}
                {run.state === "running" && <div className="hint">Keep this tab open. Emails go out 20–40 seconds apart to protect your mailbox reputation.</div>}
                <ul className="run-log">{run.log.map((l, i) => (<li key={i}>{l}</li>))}</ul>
              </div>
            )}
          </section>
        );
      })}

      {confirm && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal" role="dialog">
            <div className="modal-head"><h3>Send lot {confirm.lot.lot_no}?</h3><button className="icon-btn" onClick={() => setConfirm(null)}>✕</button></div>
            <div className="modal-body">
              <div><b>{Math.min(confirm.lot.queued, 20)} emails</b> from <b>{confirm.camp.account?.email}</b></div>
              <div className="muted">Subject: “{confirm.camp.subject}”</div>
              <div className="muted small">They will go out one by one, 20–40 seconds apart (about {Math.ceil((Math.min(confirm.lot.queued, 20) * 30) / 60)} minutes). You can pause at any time. Sending can't be undone.</div>
            </div>
            <div className="modal-foot">
              <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="primary" onClick={() => runLot(confirm.camp, confirm.lot)}>Send {Math.min(confirm.lot.queued, 20)} emails</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
