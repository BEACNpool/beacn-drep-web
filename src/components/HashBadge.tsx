export default function HashBadge({ hash }: { hash: string }) {
  return <code>{hash?.slice(0, 16)}...</code>;
}
