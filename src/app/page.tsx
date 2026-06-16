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

  const trustPass = ![
    integrity.hidden_inputs_allowed,
    integrity.undeclared_resources_allowed,
    integrity.manual_override_enabled,
    integrity.private_assistant_context_allowed,
    integrity.private_memory_allowed,
  ].some(Boolean);

  return (
    <>
      <h1>BEACN DRep — Open Governance, Verifiable by Design</h1>
      <p className="muted">
        This system is built so anyone can inspect what influenced a recommendation, reproduce it from public artifacts,
        and track how the system improves over time.
      </p>

      <section className={`card mt16 ${trustPass ? "trust-ok" : "trust-warn"}`}>
        <h2 className="m0">Trust Status: {trustPass ? "PASS" : "ALERT"}</h2>
        <p className="m0">
          {trustPass
            ? "No hidden/private influence flags are enabled."
            : "One or more integrity controls are in an unsafe state. Review immediately."}
        </p>
      </section>

      <div className="grid mt16">
        <StatCard label="Actions seen" value={idx.stats.actions_seen} />
        <StatCard label="Decisions published" value={idx.stats.decisions_published} />
        <StatCard label="Votes cast" value={idx.stats.votes_cast} />
        <StatCard label="Abstentions" value={idx.stats.abstentions} />
      </div>

      <section className="card mt16">
        <h2 className="m0">How this system makes decisions</h2>
        <ol>
          <li>Collect governance snapshots from declared source pipelines.</li>
          <li>Admit only approved resources listed in the public registry.</li>
          <li>Apply public doctrine with deterministic execution rules.</li>
          <li>Generate rationale + hashes + reproducibility manifest.</li>
          <li>Publish artifacts for independent replay and audit.</li>
        </ol>
        <div className="linkrow">
          <a href={`${GITHUB_BASE}/beacn-drep-web/blob/main/docs/OPERATING_MODEL.md`} target="_blank" rel="noreferrer">Operating Model</a>
          <a href={`${GITHUB_BASE}/beacn-drep-resources/blob/main/RESOURCE_ADMISSION_POLICY.md`} target="_blank" rel="noreferrer">Resource Admission Policy</a>
          <a href={`${GITHUB_BASE}/beacn-drep-soul/blob/main/README.md`} target="_blank" rel="noreferrer">Doctrine (Soul)</a>
        </div>
      </section>

      <section className="card mt16">
        <h2 className="m0">What cannot influence recommendations</h2>
        <ul>
          <li>Private assistant memory or local journals</li>
          <li>Private chats/DMs/unpublished notes</li>
          <li>Hidden prompts or undeclared datasets</li>
          <li>Manual score overrides outside public code and policy</li>
        </ul>
        <div className="linkrow">
          <a href={`${GITHUB_BASE}/beacn-drep-web/blob/main/docs/PUBLIC_CONTEXT_AND_LIMITS.md`} target="_blank" rel="noreferrer">Public Context & Limits</a>
        </div>
      </section>

      <section className="card mt16">
        <h2 className="m0">Trust Controls (live flags)</h2>
        <ul>
          <li>Hidden inputs allowed: <b>{String(integrity.hidden_inputs_allowed)}</b></li>
          <li>Undeclared resources allowed: <b>{String(integrity.undeclared_resources_allowed)}</b></li>
          <li>Manual override enabled: <b>{String(integrity.manual_override_enabled)}</b></li>
          <li>Private assistant context allowed: <b>{String(integrity.private_assistant_context_allowed)}</b></li>
          <li>Private memory allowed: <b>{String(integrity.private_memory_allowed)}</b></li>
        </ul>
      </section>

      <section className="card mt16">
        <h2 className="m0">How the system improves itself (without silent drift)</h2>
        <p>
          Self-correction is policy-gated. Weekly reviews classify outcomes as <b>STAY_COURSE</b>,
          <b> TUNE_NON_FUNDAMENTAL</b>, or <b>PROPOSE_FUNDAMENTAL_CHANGE</b>.
          Fundamental changes are never auto-applied.
        </p>
        <div className="linkrow">
          <a href={`${GITHUB_BASE}/beacn-drep-core/tree/main/change-control`} target="_blank" rel="noreferrer">Change Control (baseline + policy)</a>
          <a href="/docs/change-reviews/latest-weekly-review.json" target="_blank" rel="noreferrer">Latest Weekly Review</a>
          <a href={`${GITHUB_BASE}/beacn-drep-web/tree/main/docs/change-reviews`} target="_blank" rel="noreferrer">Change Review History</a>
        </div>
      </section>

      <section className="card mt16">
        <h2 className="m0">Reproducibility Receipts</h2>
        <p className="muted">Every decision should map to public commits and hashed inputs.</p>
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
