import StatCard from "@/components/StatCard";
import ActionTable from "@/components/ActionTable";
import CommitBadge from "@/components/CommitBadge";
import { getIndex, getActions, getAudit } from "@/lib/data";

const GITHUB_BASE = "https://github.com/BEACNpool";

export default async function Page() {
  const idx = await getIndex();
  const actions = await getActions();
  const audit = await getAudit();

  const integrity = audit?.integrity || {};

  return (
    <>
      <h1>BEACN DRep — Open Governance Decision Engine</h1>
      <p className="muted">
        This dashboard is designed to make decision logic auditable: doctrine is public, inputs are declared,
        artifacts are reproducible, and hidden/private context is explicitly disallowed.
      </p>

      <div className="grid">
        <StatCard label="Actions seen" value={idx.stats.actions_seen} />
        <StatCard label="Decisions published" value={idx.stats.decisions_published} />
        <StatCard label="Votes cast" value={idx.stats.votes_cast} />
        <StatCard label="Abstentions" value={idx.stats.abstentions} />
      </div>

      <section className="card mt16">
        <h2 className="m0">Trust Controls (live)</h2>
        <ul>
          <li>Hidden inputs allowed: <b>{String(integrity.hidden_inputs_allowed)}</b></li>
          <li>Undeclared resources allowed: <b>{String(integrity.undeclared_resources_allowed)}</b></li>
          <li>Manual override enabled: <b>{String(integrity.manual_override_enabled)}</b></li>
          <li>Private assistant context allowed: <b>{String(integrity.private_assistant_context_allowed)}</b></li>
          <li>Private memory allowed: <b>{String(integrity.private_memory_allowed)}</b></li>
        </ul>
        <p className="muted m0">
          Expected safe state is <b>false</b> for every item above.
        </p>
      </section>

      <section className="card mt16">
        <h2 className="m0">Decision Influence Boundary</h2>
        <p><b>Allowed:</b> public doctrine + admitted resources + deterministic execution code.</p>
        <p><b>Not allowed:</b> private memory, private chats, hidden prompts, undeclared datasets, manual score overrides.</p>
        <div className="linkrow">
          <a href={`${GITHUB_BASE}/beacn-drep-web/blob/main/docs/PUBLIC_CONTEXT_AND_LIMITS.md`} target="_blank" rel="noreferrer">Public Context & Limits</a>
          <a href={`${GITHUB_BASE}/beacn-drep-web/blob/main/docs/OPERATING_MODEL.md`} target="_blank" rel="noreferrer">Operating Model</a>
          <a href={`${GITHUB_BASE}/beacn-drep-resources/blob/main/RESOURCE_ADMISSION_POLICY.md`} target="_blank" rel="noreferrer">Resource Admission Policy</a>
        </div>
      </section>

      <section className="card mt16">
        <h2 className="m0">Reproducibility Receipts</h2>
        <p className="muted">Every decision should be reproducible from public commits and hashed inputs.</p>
        <p>
          <CommitBadge repo={idx.soul.repo} commit={idx.soul.commit} />{" "}
          <CommitBadge repo={idx.resources.repo} commit={idx.resources.commit} />{" "}
          <CommitBadge repo={idx.core.repo} commit={idx.core.commit} />
        </p>
      </section>

      <h2>Latest Actions</h2>
      <ActionTable rows={actions.slice(0, 25)} />
    </>
  );
}
