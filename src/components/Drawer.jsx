import { useEffect } from "react";

// Right-side slide-in panel.
export default function Drawer({ open, onClose, title, subtitle, children, width = 680 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`drawer-overlay ${open ? "show" : ""}`} onClick={onClose} />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        style={{ "--drawer-w": `${width}px` }}
        aria-hidden={!open}
        role="dialog"
      >
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{open ? children : null}</div>
      </aside>
    </>
  );
}
