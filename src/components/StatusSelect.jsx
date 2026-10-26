import { statusOptions, statusMeta } from "../lib/outreach";

export default function StatusSelect({ channel, value, onChange, disabled }) {
  const m = statusMeta(channel, value);
  return (
    <select
      className={`status-select status-${m?.color ?? "gray"}`}
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {statusOptions(channel).map((s) => (
        <option key={s.key} value={s.key}>{s.label}</option>
      ))}
    </select>
  );
}

export function StatusPill({ channel, value }) {
  const m = statusMeta(channel, value);
  return <span className={`status status-${m?.color ?? "gray"}`}>{m?.label ?? value}</span>;
}
