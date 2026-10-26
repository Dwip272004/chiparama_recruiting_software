import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchNotifications, markRead, fetchActivityFeed } from "../lib/notifications";
import { channelByKey, statusMeta, initials } from "../lib/outreach";
import { timeAgo } from "../lib/dashboard";
import { BellIcon, PulseIcon, FileIcon, UserPlusIcon, StarIcon, MsgIcon, CheckIcon, PhoneIcon } from "./Icons";

const TITLES = [
  [/^\/jobs\/[^/]+\/candidates/, "Job candidates"],
  [/^\/jobs/, "Jobs"],
  [/^\/calling\/./, "Calling"],
  [/^\/calling/, "Calling list"],
  [/^\//, "Dashboard"],
];

const NOTE_ICON = {
  jd_submitted: [FileIcon, "blue"],
  job_status: [CheckIcon, "green"],
  assigned: [UserPlusIcon, "amber"],
  candidate_interested: [StarIcon, "green"],
  candidate_replied: [MsgIcon, "purple"],
};

function useOutside(ref, onClose) {
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [ref, onClose]);
}

function activityLine(a) {
  if (a.type === "jd_submitted") return { icon: FileIcon, tone: "blue", text: <><b>{a.actor ?? "Someone"}</b> submitted {a.job_code}</>, sub: a.subject ?? "Awaiting review" };
  if (a.type === "jd_reviewed") return { icon: CheckIcon, tone: "green", text: <><b>{a.actor ?? "An admin"}</b> reviewed {a.job_code}</>, sub: a.subject ?? "" };
  const ch = channelByKey(a.channel);
  const label = statusMeta(a.channel, a.to_status)?.label ?? a.to_status;
  const tone = statusMeta(a.channel, a.to_status)?.color ?? "gray";
  return {
    icon: a.channel === "call" ? PhoneIcon : MsgIcon,
    tone,
    text: <><b>{a.actor ?? "System"}</b> · {a.subject}</>,
    sub: `${ch?.label ?? a.channel} → ${label} · ${a.job_code}${a.note ? ` · “${a.note.slice(0, 60)}”` : ""}`,
  };
}

export default function TopBar() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(null); // 'notes' | 'activity' | null
  const [notes, setNotes] = useState([]);
  const [feed, setFeed] = useState(null);
  const [err, setErr] = useState("");
  const wrap = useRef(null);
  const close = useCallback(() => setOpen(null), []);
  useOutside(wrap, close);

  const loadNotes = useCallback(async () => {
    try { setNotes(await fetchNotifications()); } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => {
    loadNotes();
    const t = setInterval(loadNotes, 30000);
    const onFocus = () => loadNotes();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [loadNotes]);

  useEffect(() => { setOpen(null); }, [pathname]);

  const unread = notes.filter((n) => !n.read_at).length;

  const toggle = async (which) => {
    const next = open === which ? null : which;
    setOpen(next);
    if (next === "activity") {
      try { setFeed(await fetchActivityFeed(40)); setErr(""); } catch (e) { setErr(e.message); }
    }
    if (next === "notes") loadNotes();
  };

  const openNote = async (n) => {
    if (!n.read_at) {
      setNotes((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      markRead([n.id]).catch(() => {});
    }
    setOpen(null);
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    setNotes((l) => l.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    try { await markRead(null); } catch (e) { setErr(e.message); }
  };

  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "";

  return (
    <header className="appbar" ref={wrap}>
      <div className="appbar-title">{title}</div>
      <div className="appbar-actions">
        <div className="pop-anchor">
          <button className={`icon-tool ${open === "activity" ? "on" : ""}`} onClick={() => toggle("activity")} aria-label="Activity" title="Activity">
            <PulseIcon />
          </button>
          {open === "activity" && (
            <div className="popover" role="dialog" aria-label="Activity">
              <div className="pop-head"><h4>Activity</h4><span className="muted small">Latest across your work</span></div>
              <div className="pop-body">
                {err && <div className="msg error">{err}</div>}
                {!feed && !err && <div className="empty small">Loading…</div>}
                {feed && feed.length === 0 && <div className="empty small">No activity yet.</div>}
                {feed && feed.map((a) => {
                  const l = activityLine(a);
                  const Icon = l.icon;
                  return (
                    <div key={a.id} className="pop-item static">
                      <span className={`pi-icon tone-${l.tone}`}><Icon width={15} height={15} /></span>
                      <div className="pi-main">
                        <div className="pi-title">{l.text}</div>
                        <div className="pi-sub">{l.sub}</div>
                      </div>
                      <span className="pi-time">{timeAgo(a.at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="pop-anchor">
          <button className={`icon-tool ${open === "notes" ? "on" : ""}`} onClick={() => toggle("notes")} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} title="Notifications">
            <BellIcon />
            {unread > 0 && <span className="dot-badge">{unread > 9 ? "9+" : unread}</span>}
          </button>
          {open === "notes" && (
            <div className="popover" role="dialog" aria-label="Notifications">
              <div className="pop-head">
                <h4>Notifications</h4>
                <button className="link" onClick={readAll} disabled={!unread}>Mark all read</button>
              </div>
              <div className="pop-body">
                {err && <div className="msg error">{err}</div>}
                {notes.length === 0 && <div className="empty small">You're all caught up.</div>}
                {notes.map((n) => {
                  const [Icon, tone] = NOTE_ICON[n.kind] ?? [BellIcon, "gray"];
                  return (
                    <button key={n.id} className={`pop-item ${n.read_at ? "" : "unread"}`} onClick={() => openNote(n)}>
                      <span className={`pi-icon tone-${tone}`}><Icon width={15} height={15} /></span>
                      <div className="pi-main">
                        <div className="pi-title">{n.title}</div>
                        {n.body && <div className="pi-sub">{n.body}</div>}
                      </div>
                      <span className="pi-time">{timeAgo(n.created_at)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="avatar" title={profile.full_name || profile.email}>{initials(profile.full_name || profile.email)}</div>
      </div>
    </header>
  );
}
