import StatCard from "@/components/StatCard";
import ActionTable from "@/components/ActionTable";
import CommitBadge from "@/components/CommitBadge";
import { getIndex, getActions } from "@/lib/data";

export default async function Page() {
  const idx = await getIndex();
  const actions = await getActions();
  return (
    <>
      <h1>Home</h1>
      <div className="grid">
        <StatCard label="Actions seen" value={idx.stats.actions_seen} />
        <StatCard label="Decisions published" value={idx.stats.decisions_published} />
        <StatCard label="Votes cast" value={idx.stats.votes_cast} />
        <StatCard label="Abstentions" value={idx.stats.abstentions} />
      </div>
      <p><CommitBadge repo={idx.soul.repo} commit={idx.soul.commit} /> <CommitBadge repo={idx.resources.repo} commit={idx.resources.commit} /> <CommitBadge repo={idx.core.repo} commit={idx.core.commit} /></p>
      <ActionTable rows={actions.slice(0, 25)} />
    </>
  );
}
