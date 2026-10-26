import { useState } from "react";

const key = (id) => `chiparama-open-${id}`;
const read = (id, d) => { try { const v = localStorage.getItem(key(id)); return v === null ? d : v === "1"; } catch { return d; } };

// Compact dropdown panel: header shows title, count and a one-line preview; body opens on click.
export default function Collapsible({ id, title, count, tone = "gray", preview, defaultOpen = false, children }) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key(id), o ? "0" : "1"); } catch { /* ignore */ }
      return !o;
    });
  };
  return (
    <section className={`collapsible ${open ? "open" : ""} tone-${tone}`}>
      <button type="button" className="coll-head" onClick={toggle} aria-expanded={open} aria-controls={`coll-${id}`}>
        <span className="coll-title">{title}</span>
        {count !== undefined && <span className={`coll-count ${count > 0 ? "has" : ""}`}>{count}</span>}
        {!open && preview && <span className="coll-preview">{preview}</span>}
        <svg className="coll-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className="coll-body" id={`coll-${id}`}>{children}</div>}
    </section>
  );
}
