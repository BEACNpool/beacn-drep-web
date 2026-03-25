export default function StatCard({ label, value }: { label: string; value: string | number }) {
  return <div className="card"><div className="muted">{label}</div><div><b>{value}</b></div></div>;
}
