export default function StatusBadge({ statusKey, statuses }) {
  const s = statuses.find((x) => x.key === statusKey);
  return <span className={`status status-${s?.color ?? "gray"}`}>{s?.label ?? statusKey}</span>;
}
