export default function RationaleCard({ item }: { item: any }) {
  return <div className="card"><b>{item.action_id}</b><div>{item.summary}</div><div className="muted">{item.published_at}</div></div>;
}
