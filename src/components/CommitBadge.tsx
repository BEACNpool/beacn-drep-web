export default function CommitBadge({ repo, commit }: { repo: string; commit: string }) {
  return <span className="card" style={{ display: "inline-block", padding: "4px 8px" }}>{repo}@{commit.slice(0, 12)}</span>;
}
