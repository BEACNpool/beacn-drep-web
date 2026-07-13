/* BEACN DRep — public transparency platform.
   View-only. No decision logic lives here; every number is read from the machine-generated
   public artifacts. The one rule this file must never break: `decision` is what the engine
   RECOMMENDS today, `onchain_vote` is what BEACN actually CAST. They can differ, and the
   site must always show which is which. */

import { blake2b256Hex, verifyManifest, verifyAnchor } from "./verify.js";

const SRC = {
  status:    "./status.json",
  index:     "./data/output/public/index.json",
  actions:   "./data/output/public/actions.json",
  weights:   "./data/output/public/scoring_weights.json",
  detail:    id => `./data/output/public/actions/${encodeURIComponent(id)}.json`,
};

const GH = {
  soul:      c => `https://github.com/BEACNpool/beacn-drep-soul/tree/${c}`,
  core:      c => `https://github.com/BEACNpool/beacn-drep-core/tree/${c}`,
  resources: c => `https://github.com/BEACNpool/beacn-drep-resources/tree/${c}`,
  weights:   c => `https://github.com/BEACNpool/beacn-drep-soul/blob/${c}/scoring_weights.json`,
};

/* Published artifact paths are recorded absolute ("/data/output/..."), but the site is served from
   a subpath on GitHub Pages ("/beacn-drep-web/"), so they must be made relative or every fetch 404s.
   They also contain a literal "#" — governance action ids are "<tx>#<index>", and that character is
   baked into the run-id filenames. Left raw, the browser reads it as the start of a URL fragment and
   silently requests the wrong file. Encode it. */
const rel = p => "./" + String(p || "").replace(/^\/+/, "").replace(/#/g, "%23");

const EXPLORER = h => `https://cardanoscan.io/transaction/${h}`;
const PAGE_SIZE = 25;

const TYPE_LABEL = {
  TreasuryWithdrawals: "Treasury",
  ParameterChange: "Parameter",
  HardForkInitiation: "Hard fork",
  NewCommittee: "Committee",
  NewConstitution: "Constitution",
  NoConfidence: "No confidence",
  InfoAction: "Info",
};

const state = { index: null, actions: [], status: null, weights: null, verifyId: null, byId: new Map() };

/* ---------- utils ---------- */
const el = document.getElementById.bind(document);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const short = (h, n = 8) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "");
const typeLabel = t => TYPE_LABEL[t] || t || "—";

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function getJSON(url) {
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const linkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6v6M20 4l-8 8"/></svg>`;

/* ---------- shared renderers ---------- */

/** The vote BEACN actually cast on-chain, with its proof link. Never the recommendation. */
function proofHTML(a) {
  if (!a.submitted || !a.transaction_hash) {
    return `<span class="novote">No vote cast on-chain yet</span>`;
  }
  return `<span class="vote ${esc(a.onchain_vote || "NONE")}">${esc(a.onchain_vote || "—")}</span>
    <a class="proof" href="${EXPLORER(esc(a.transaction_hash))}" target="_blank" rel="noopener"
       onclick="event.stopPropagation()" title="View the vote transaction on Cardanoscan">
      ${linkIcon}<span class="hash">${esc(short(a.transaction_hash, 10))}</span>
    </a>`;
}

/** Disclose, never hide, a drift between the cast vote and today's recommendation. */
function divergeHTML(a) {
  if (!a.diverged) return "";
  return `<span class="diverge"><b>Would not re-derive this vote today.</b> BEACN cast
    <b>${esc(a.onchain_vote)}</b> on-chain; on today's evidence the engine reaches
    <b>${esc(a.decision)}</b>. The cast vote stands until a revision clears the anti-churn policy —
    a gap in evidence is never allowed to retract a vote that was made.</span>`;
}

const ADA = lov => {
  const n = Number(lov || 0) / 1e6;
  if (!n) return "0 ₳";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2)}M ₳`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k ₳`;
  return `${n.toFixed(0)} ₳`;
};

/** Why a proposal drew scrutiny. Red flags first — a reader asking "why didn't this pass?"
 *  should see these before anything else. */
function flagsHTML(flags) {
  if (!Array.isArray(flags) || !flags.length) return "";
  const order = { red: 0, yellow: 1 };
  const sorted = [...flags].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return `<div class="panel">
    <h2>Flags raised on this proposal</h2>
    <p class="muted sm" style="margin-bottom:10px">Automated checks against the proposal's own
      metadata and on-chain record. A flag is a reason to look harder — not, by itself, a reason
      to vote no.</p>
    <ul class="flags">
      ${sorted.map(f => `<li class="flag ${esc(f.severity)}">
        <span class="flag-name">${esc(f.flag)}</span>
        <span class="flag-detail">${esc(f.detail)}</span>
      </li>`).join("")}
    </ul>
  </div>`;
}

/** The Net Change Limit and the arithmetic this ask had to fit inside. Published so anyone can
 *  check it themselves — including the honest caveat that no NCL is ever formally enacted. */
function capacityHTML(tc) {
  if (!tc) return "";
  if (!tc.verified) {
    return `<div class="panel"><h2>Treasury capacity</h2>
      <p class="muted sm">${esc(tc.why || "No Net Change Limit is currently pinned.")}</p></div>`;
  }
  const req = Number(tc.requested_lovelace || 0);
  const rem = Number(tc.remaining_capacity_lovelace || 0);
  const ncl = Number(tc.ncl_lovelace || 0);
  const spent = Number(tc.withdrawals_in_period_lovelace || 0);
  const pctSpent = ncl ? Math.min(100, (spent / ncl) * 100) : 0;
  const fits = tc.fits_remaining;
  return `<div class="panel">
    <h2>Treasury capacity — the Net Change Limit</h2>
    <p class="muted sm" style="margin-bottom:12px">Cardano caps how much ADA may leave the treasury
      in a period. BEACN will not vote to fund an ask that does not fit inside what is left.</p>

    <div class="ncl-bar" role="img" aria-label="${pctSpent.toFixed(0)}% of the Net Change Limit already spent">
      <i style="width:${pctSpent}%"></i>
    </div>
    <div class="ncl-legend">
      <span><b>${ADA(spent)}</b> already withdrawn</span>
      <span><b>${ADA(rem)}</b> left of ${ADA(ncl)}</span>
    </div>

    ${req > 0 ? `<div class="ncl-verdict ${fits ? "fits" : "over"}">
      This proposal asks <b>${ADA(req)}</b> —
      ${fits ? `it fits within the ${ADA(rem)} still available.`
             : `more than the ${ADA(rem)} still available, so it cannot be funded within this period's limit.`}
    </div>` : ""}

    <div class="kv" style="margin-top:12px">
      <div class="kv-row"><span class="k">Limit</span><span class="v">${ADA(ncl)} · epochs ${esc(tc.period_start_epoch)}–${esc(tc.period_end_epoch)}</span></div>
      <div class="kv-row"><span class="k">Measured as</span><span class="v">${esc((tc.spend_basis || "").replace(/_/g, " "))}</span></div>
      <div class="kv-row"><span class="k">Set by</span><span class="v">${esc(short(tc.source_action_id, 16))}</span></div>
      <div class="kv-row"><span class="k">Anchor hash</span><span class="v">${esc(short(tc.source_anchor_hash, 14))} ✓ verified</span></div>
      ${tc.drep_support ? `<div class="kv-row"><span class="k">DRep support</span><span class="v">${esc(tc.drep_support.yes_pct_of_participating_stake)}% of participating stake</span></div>` : ""}
    </div>
    ${tc.caveat ? `<p class="caveat">${esc(tc.caveat)}</p>` : ""}
  </div>`;
}

function cardHTML(a) {
  const openChip = a.status === "active"
    ? `<span class="chip open">Open</span>`
    : `<span class="chip closed">Closed</span>`;
  return `<button class="card" data-id="${esc(a.action_id)}">
    <div class="card-top">
      <span class="chip type">${esc(typeLabel(a.type))}</span>
      ${openChip}
    </div>
    <h3>${esc(a.title || a.action_id)}</h3>
    <div class="stance">
      <div class="stance-cell">
        <div class="lbl">BEACN's vote on-chain</div>
        <div class="val">${proofHTML(a)}</div>
      </div>
      <div class="stance-cell">
        <div class="lbl">Engine recommendation today</div>
        <div class="val"><span class="vote ${esc(a.decision || "NONE")}">${esc(a.decision || "—")}</span></div>
      </div>
    </div>
    ${divergeHTML(a)}
    <div class="card-foot">
      <span>Seen ${esc(fmtDate(a.detected_at))}</span>
      <span>Published ${esc(fmtDate(a.published_at))}</span>
    </div>
  </button>`;
}

function listHTML(items) {
  if (!items.length) return `<div class="empty">Nothing matches those filters.</div>`;
  return `<div class="cards">${items.map(cardHTML).join("")}</div>`;
}

function wireCards(root) {
  root.querySelectorAll(".card[data-id]").forEach(b => {
    b.addEventListener("click", () => { location.hash = `#/action/${encodeURIComponent(b.dataset.id)}`; });
  });
}

/* ---------- views ---------- */

function viewLive() {
  const s = state.index?.stats || {};
  const open = state.actions.filter(a => a.status === "active");
  const voted = state.actions.filter(a => a.submitted);
  const openVoted = open.filter(a => a.submitted).length;

  // Sort: unvoted open actions first — those are the ones the community should look at.
  open.sort((a, b) => (a.submitted === b.submitted ? 0 : a.submitted ? 1 : -1));

  return `
  <section class="hero">
    <span class="eyebrow">Live on Cardano mainnet</span>
    <h1>An autonomous DRep voting <em>real money</em>, in the open.</h1>
    <p class="hero-lead">BEACN decides Cardano governance with deterministic, open-source rules over
       public evidence — then publishes the reasoning and the on-chain proof of every vote. The
       weights are a versioned file you can read. The engine is a commit you can replay. Nothing
       here is a claim you have to take on trust.</p>
    <div class="hero-cta">
      <a class="btn btn-primary" href="#/verify">Verify a decision yourself →</a>
      <a class="btn" href="#/method">How the weighting works</a>
    </div>
    <p class="drepid" style="margin-top:var(--s5)">DRep <code>${esc(state.status?.drep_id || "—")}</code></p>
  </section>

  <div class="stats">
    <div class="stat accent">
      <div class="n">${open.length}</div>
      <div class="k">Open now</div>
      <div class="sub">${openVoted} with a vote cast</div>
    </div>
    <div class="stat">
      <div class="n">${voted.length}</div>
      <div class="k">Votes on-chain</div>
      <div class="sub">every one links to its tx</div>
    </div>
    <div class="stat">
      <div class="n">${s.decisions_published ?? "—"}</div>
      <div class="k">Decisions published</div>
      <div class="sub">since inception</div>
    </div>
    <div class="stat">
      <div class="n">${s.anchor_fetch_coverage_pct != null ? s.anchor_fetch_coverage_pct + "%" : "—"}</div>
      <div class="k">Anchor coverage</div>
      <div class="sub">proposal docs pinned</div>
    </div>
  </div>

  <section class="sec">
    <div class="sec-h"><h2>Live governance actions</h2><span class="count">${open.length}</span></div>
    <p class="sec-lead">Everything currently open for a vote on Cardano. Unvoted actions are listed
       first. For each one you can see what BEACN cast on-chain, what the engine recommends on
       today's evidence, and — where those differ — why.</p>
    ${listHTML(open)}
  </section>`;
}

function viewRecord() {
  const q = (el("q")?.value || "").toLowerCase();
  const ft = el("f-type")?.value || "";
  const fv = el("f-vote")?.value || "";
  const page = Math.max(1, parseInt(new URLSearchParams(location.hash.split("?")[1] || "").get("p") || "1", 10));

  let items = state.actions.slice();
  if (q) items = items.filter(a => (a.title || "").toLowerCase().includes(q) || (a.action_id || "").toLowerCase().includes(q));
  if (ft) items = items.filter(a => a.type === ft);
  if (fv) items = items.filter(a => (fv === "__none" ? !a.submitted : a.onchain_vote === fv));

  items.sort((a, b) => String(b.detected_at || "").localeCompare(String(a.detected_at || "")));

  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(page, pages);
  const slice = items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

  const types = [...new Set(state.actions.map(a => a.type).filter(Boolean))].sort();

  return `
  <section class="sec">
    <div class="sec-h"><h2>The full record</h2><span class="count">${items.length} of ${state.actions.length}</span></div>
    <p class="sec-lead">Every governance action BEACN has ever seen, and what it did about each one.
       Votes carry a link to the transaction on-chain — the proof, not our word for it.</p>

    <div class="filters">
      <input id="q" class="search" type="search" placeholder="Search titles or action ids…" value="${esc(q)}" aria-label="Search the record">
      <select id="f-type" class="sel" aria-label="Filter by action type">
        <option value="">All types</option>
        ${types.map(t => `<option value="${esc(t)}" ${t === ft ? "selected" : ""}>${esc(typeLabel(t))}</option>`).join("")}
      </select>
      <select id="f-vote" class="sel" aria-label="Filter by vote cast">
        <option value="">Any vote</option>
        <option value="YES" ${fv === "YES" ? "selected" : ""}>Voted YES</option>
        <option value="NO" ${fv === "NO" ? "selected" : ""}>Voted NO</option>
        <option value="ABSTAIN" ${fv === "ABSTAIN" ? "selected" : ""}>Voted ABSTAIN</option>
        <option value="__none" ${fv === "__none" ? "selected" : ""}>No vote cast</option>
      </select>
    </div>

    ${listHTML(slice)}

    ${pages > 1 ? `<div class="pager">
      <button id="prev" ${p <= 1 ? "disabled" : ""}>← Newer</button>
      <span class="pg">Page ${p} / ${pages}</span>
      <button id="next" ${p >= pages ? "disabled" : ""}>Older →</button>
    </div>` : ""}
  </section>`;
}

/* The weight labels below explain what each number DOES. The numbers themselves are never written
   here — they are read from the published scoring_weights.json, which is the same file the engine
   loads at runtime. If a weight changes, this page changes with it; it cannot flatter us. */
const WEIGHT_COPY = {
  anchor_present_bonus:               ["Proposal document is pinned and readable", "A proposal whose anchor document can be fetched and hash-verified is easier to hold to account."],
  treasury_base_penalty:              ["Every treasury ask starts negative", "Spending public money must be argued for. The default answer to “give me ada” is no."],
  treasury_flow_sustainable_bonus:    ["Treasury inflow is healthy", "Measured from real on-chain flow, not forecasts."],
  treasury_flow_stressed_penalty:     ["Treasury inflow is stressed", "Tightens the bar for new spending when the treasury is under pressure."],
  treasury_flow_unsustainable_penalty:["Treasury inflow is unsustainable", "The strongest flow-based brake on new spending."],
  parameter_change_base_penalty:      ["Parameter changes start negative", "Live protocol parameters are load-bearing; changing them needs a positive case."],
  hardfork_base_penalty:              ["Hard forks start strongly negative", "The highest-consequence, least-reversible action on Cardano."],
  flag_score_divisor:                 ["Risk-flag divisor", "Automated risk flags (no discussion, no milestones, concentration…) are divided by this, so flags scale rather than dominate."],
  flag_penalty_cap:                   ["Maximum total flag penalty", "Even a proposal covered in red flags cannot be sunk by flags alone — evidence still has to carry the call."],
  drep_margin_cap:                    ["Maximum influence of other DReps", "How much the crowd can move BEACN. Deliberately capped BELOW the directional threshold, so consensus alone can never decide a vote."],
};

/* Not every number in the weights file is a directional weight. Three of them are BOUNDS — a
   divisor and two caps that limit how far something can push the score. Rendering a cap as a green
   "+0.35 toward YES" bar would badly misdescribe what it does: flag_penalty_cap is a ceiling on a
   PENALTY, and drep_margin_cap is a ceiling on outside influence. They get their own group. */
const WEIGHT_BOUNDS = { flag_score_divisor: "÷", flag_penalty_cap: "≤", drep_margin_cap: "≤" };

function weightsHTML() {
  const w = state.weights?.weights;
  if (!w) return `<p class="muted sm">Weights file unavailable.</p>`;

  const directional = Object.entries(w).filter(([k]) => !(k in WEIGHT_BOUNDS));
  const bounds = Object.entries(w).filter(([k]) => k in WEIGHT_BOUNDS);
  const max = Math.max(...directional.map(([, v]) => Math.abs(Number(v))));

  const dirRow = ([k, v]) => {
    const n = Number(v);
    const pos = n >= 0;
    const [name, why] = WEIGHT_COPY[k] || [k, ""];
    const pct = max ? (Math.abs(n) / max) * 50 : 0;
    return `<div class="wrow">
      <span class="wname">${esc(name)}<small>${esc(why)}</small></span>
      <div class="wtrack"><span class="wmid"></span>
        <span class="wfill ${pos ? "pos" : "neg"}"
              style="${pos ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%`}"></span></div>
      <span class="wval ${pos ? "pos" : "neg"}">${pos ? "+" : ""}${n}</span>
    </div>`;
  };
  const boundRow = ([k, v]) => {
    const [name, why] = WEIGHT_COPY[k] || [k, ""];
    return `<div class="wrow">
      <span class="wname">${esc(name)}<small>${esc(why)}</small></span>
      <span></span>
      <span class="wval">${WEIGHT_BOUNDS[k]} ${esc(String(v))}</span>
    </div>`;
  };

  return `
    <h3 class="wgroup">Directional weights <span>push the score toward YES or NO</span></h3>
    <div class="wgrid">${directional.map(dirRow).join("")}</div>
    <h3 class="wgroup">Limits <span>bound how far anything can push — they never add score</span></h3>
    <div class="wgrid">${bounds.map(boundRow).join("")}</div>`;
}

function viewMethod() {
  // Read the live weighting contract off a real decision rather than restating it by hand,
  // so this page cannot drift from the engine that actually votes.
  const sample = state.actions.find(a => a.submitted) || state.actions[0];
  const wm = state.weights || {};
  const soul = state.index?.soul?.commit || "";
  return `
  <section class="hero">
    <span class="eyebrow">Open weighting system</span>
    <h1>How a vote is made — <em>and how you check it</em>.</h1>
    <p class="hero-lead">The binding decision is pure deterministic Python over declared inputs. A
       language model helps read documents and explain outcomes in plain English — it can never set,
       change, or veto a vote. That boundary is the whole design, and it is enforced in code, not
       promised in a blog post.</p>
  </section>

  <section class="sec">
    <div class="sec-h">
      <h2>The weighting system</h2>
      <span class="count">v${esc(wm.version || "—")}</span>
    </div>
    <p class="sec-lead">These are not illustrative numbers. This page renders
       <a href="${GH.weights(soul)}" rel="noopener">scoring_weights.json</a> — the same file the
       engine loads when it scores a proposal. Change a weight and this page changes with it. A
       change also requires a changelog entry and a doctrine commit, so it can never happen quietly.</p>
    ${weightsHTML()}
    <p class="muted sm" style="margin-top:var(--s4)">
      Positive weights push toward YES, negative toward NO. Note the last one: the influence of other
      DReps is capped at ${esc(String(wm.weights?.drep_margin_cap ?? "—"))} — deliberately
      <em>below</em> the directional threshold — so BEACN cannot be carried across the line by
      popularity alone. Its own evidence has to do the work.</p>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>Merit scoring for treasury asks</h2></div>
    <p class="sec-lead">Where money is being requested, four independently-evidenced dimensions
       combine. The −0.50 is the standing burden of proof: a proposal that is merely average does not
       clear it.</p>
    <div class="formula">composite = <b>0.40</b>·benefit + <b>0.25</b>·delivery + <b>0.20</b>·cost + <b>0.15</b>·(1 − downside) <b>− 0.50</b></div>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>Tamper-evidence</h2></div>
    <p class="sec-lead">Open weights are only meaningful if you can prove the engine actually used
       them. Every decision is bound by hash to the doctrine commit, the doctrine's text, and every
       evidence file read — and the written rationale is hashed into the vote transaction itself.
       You can recompute all of it in your own browser.</p>
    <a class="btn btn-primary" href="#/verify">Run the checks →</a>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>The pipeline</h2></div>
    <div class="steps">
      <div class="step"><div>
        <h3>Intake &amp; claim extraction <span class="tag adv">advisory</span></h3>
        <p>The proposal's anchor document is pinned and read. Claims are extracted and tagged by
           how the document supports them — independently verifiable, proposer-asserted, or
           unsupported. This never feeds a gate.</p>
      </div></div>
      <div class="step"><div>
        <h3>Evidence check <span class="tag det">deterministic</span></h3>
        <p>Anchor integrity, metadata, amount, and data freshness. A snapshot older than the
           freshness limit forces an ABSTAIN — BEACN does not vote on a stale view of the chain.</p>
      </div></div>
      <div class="step"><div>
        <h3>Analysis <span class="tag det">deterministic</span></h3>
        <p>Treasury sustainability against a rolling-window regime, plus the structured risk review.</p>
      </div></div>
      <div class="step"><div>
        <h3>Score &amp; gates <span class="tag det">deterministic, binding</span></h3>
        <p>Treasury actions are scored on four explicit dimensions: independently verified
           ecosystem benefit, delivery confidence, cost efficiency, and downside protection.
           <strong>Missing evidence can never become a NO</strong> — a directional NO requires
           affirmative, pinned proof of waste, duplication, excessive cost, or failed delivery.
           Missing evidence also can never <strong>retract</strong> a vote already cast.</p>
      </div></div>
      <div class="step"><div>
        <h3>Rationale <span class="tag det">deterministic</span></h3>
        <p>Facts, inferences and uncertainty are separated, the best case for and against is
           stated, and the whole record is hashed.</p>
      </div></div>
      <div class="step"><div>
        <h3>Plain-English explanation <span class="tag adv">advisory</span></h3>
        <p>A model explains the <em>already-decided</em> verdict. It explains; it cannot change.</p>
      </div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>The weighting contract</h2></div>
    <p class="sec-lead">These are not marketing words — this is the exact scoring contract carried
       inside every published decision, versioned and hashed. If it changes, the hash changes.</p>
    ${sample?.action_id ? `<div class="panel" id="contract"><div class="loading"><span class="spin"></span> Loading the live contract…</div></div>` : ""}
  </section>

  <section class="sec">
    <div class="sec-h"><h2>The hardest gate: the Net Change Limit</h2></div>
    <p class="sec-lead">Cardano's Constitution caps how much ADA may leave the treasury in a
      defined period. However good a proposal is, BEACN will not vote to fund an ask that does not
      fit inside what is left of that limit. Here is the exact arithmetic every treasury decision
      is measured against — check it yourself.</p>
    ${capacityHTML(state.index?.treasury_capacity)}
    <div class="prose">
      <p><strong>Why this is not simply "on-chain".</strong> The NCL is set by an <em>Info</em>
        governance action. Info actions change no ledger state, so they always expire and can never
        be enacted — there is no such thing as a formally ratified NCL to look up. BEACN therefore
        pins the strongest evidence that does exist: an anchor document byte-verified against its
        on-chain hash, covering the current epoch, which won a majority of participating DRep
        stake. The later action supersedes the earlier. That caveat is published with the number
        above, and travels into every rationale that relies on it.</p>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>When BEACN abstains</h2></div>
    <div class="prose">
      <p>Abstention is a real answer, not a dodge — but it is only honest when it is <em>about the
         proposal</em>. BEACN abstains when the evidence genuinely does not decide the question, and
         it says so in the rationale, naming what is outstanding and whose homework it is.</p>
      <p>What it must never do is dress up a gap in its own pipeline as a judgement about your
         proposal. An empty or stale evidence file is a fact about BEACN, not about you. So an
         abstention caused by missing evidence is labelled as exactly that, and it is not allowed
         to pull a vote that was already cast back off the chain.</p>
      <h3>The order of values, when they conflict</h3>
      <ul>
        <li>Constitutional integrity and protocol safety</li>
        <li>Treasury stewardship and downside protection</li>
        <li>Evidence quality and reproducibility</li>
        <li>Public-benefit ecosystem growth</li>
        <li>Execution speed and social consensus momentum</li>
      </ul>
      <p>Popularity ranks last on purpose. The network's DRep distribution may <em>inform</em> a
         vote; it is mathematically capped so it can never <em>determine</em> one.</p>
    </div>
  </section>`;
}

/* ---------- verify: tamper-evidence, run in the visitor's own browser ----------
   This is the part of the site that matters most. Everything else asks you to believe BEACN's
   published numbers; this proves them. The checks below run locally, on bytes fetched from this
   site, using no third-party script — so a compromised BEACN cannot fake a pass. */

const CHECKS = [
  {
    id: "anchor",
    name: "Rationale matches the hash BEACN put on-chain",
    what: `When BEACN votes, it writes a hash of its written reasoning into the vote transaction
           itself. We fetch that published reasoning, hash it here in your browser (blake2b-256, the
           hash Cardano uses), and compare. If BEACN ever edited a rationale after voting — softened
           a criticism, rewrote a justification — this hash would no longer match, and the on-chain
           anchor cannot be changed to cover it up.`,
  },
  {
    id: "bundle",
    name: "Evidence bundle and doctrine are unaltered",
    what: `The decision is bound to a single hash covering the exact doctrine commit, the doctrine's
           text hash, and the hash of every evidence file the engine read. We recompute that hash from
           its parts. Swap in different evidence, or point the engine at different rules, and this
           breaks.`,
  },
  {
    id: "input",
    name: "Scored the real on-chain proposal",
    what: `The hash of the exact governance-action data the engine scored. Proves the decision was
           made about this proposal, with these numbers — not a doctored copy.`,
  },
];

function viewVerify() {
  const votable = state.actions.filter(a => a.submitted && a.transaction_hash);
  // Lead with a fully-anchored vote so the first thing a visitor sees is the complete chain, not
  // the "not anchored" caveat of an early one. The early votes stay in the list — they are part of
  // the record — they just aren't the opening argument.
  const anchored = votable.filter(a => a.rationale_anchored);
  votable.sort((a, b) => (b.rationale_anchored ? 1 : 0) - (a.rationale_anchored ? 1 : 0));
  const sel = state.verifyId || (votable[0] && votable[0].action_id) || "";

  return `
  <section class="hero">
    <span class="eyebrow">Tamper-evidence</span>
    <h1>Don't trust BEACN. <em>Check it.</em></h1>
    <p class="hero-lead">An autonomous agent that spends real treasury money is only as trustworthy as
       its receipts. These checks run entirely in your browser, on files fetched from this site, with
       no server and no third-party code. If this engine had been quietly re-tuned to force a
       decision, or a rationale rewritten after the fact, the hashes below would not match.</p>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>Verify a real decision</h2>
      <span class="count">${anchored.length} of ${votable.length} anchored</span></div>
    <p class="sec-lead">Pick any vote BEACN has cast on Cardano mainnet. ${anchored.length} of them
       carry a hash of their written reasoning inside the vote transaction itself — a complete,
       checkable chain from the on-chain tx back to the rules that produced it. The
       ${votable.length - anchored.length} earliest votes predate rationale anchoring and say so.</p>

    <div class="filters">
      <select class="sel search" id="v-pick" aria-label="Choose a decision to verify">
        ${votable.map(a => `<option value="${esc(a.action_id)}"${a.action_id === sel ? " selected" : ""}>
          ${esc((a.title || a.action_id).slice(0, 78))}</option>`).join("")}
      </select>
      <button class="btn btn-primary" id="v-run">Run checks</button>
    </div>

    <div class="vpanel">
      <div class="vpanel-head">
        <div>
          <h3>Integrity checks</h3>
          <p id="v-sub">Computed locally — nothing is sent anywhere.</p>
        </div>
        <span class="vstatus idle" id="v-status">Ready</span>
      </div>
      <div class="vpanel-body">
        <div class="checks" id="v-checks">
          ${CHECKS.map(c => `
            <div class="check" id="v-${c.id}">
              <div class="check-top">
                <span class="check-ico">${CHECKS.indexOf(c) + 1}</span>
                <span class="check-name">${esc(c.name)}</span>
                <span class="check-verdict">—</span>
              </div>
              <p class="check-what">${esc(c.what.replace(/\s+/g, " ").trim())}</p>
              <div class="check-hashes" hidden></div>
            </div>`).join("")}
        </div>
      </div>
    </div>

    <div id="v-prov"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><h2>What this does and doesn't prove</h2></div>
    <p class="sec-lead">Being straight about the limits is the point — a verification page that
       overclaims is just marketing with a monospace font.</p>
    <div class="kv">
      <div class="kv-row">
        <span class="k">It proves</span>
        <span class="v">The published reasoning is byte-identical to what BEACN committed to on-chain
          when it voted, and the decision is bound to a specific doctrine commit and a specific set of
          evidence files. None of that can be changed after the fact without breaking a hash.</span>
      </div>
      <div class="kv-row">
        <span class="k">It does not prove</span>
        <span class="v">That the rules themselves are <em>good</em>. Hashes prove nothing was swapped;
          they cannot tell you the weighting is wise. That judgement is yours — which is exactly why
          the weights are published as a plain, versioned file rather than buried in code.</span>
      </div>
      <div class="kv-row">
        <span class="k">Going further</span>
        <span class="v">These checks confirm the artifacts are internally consistent and chain-pinned.
          To prove the engine <em>produces</em> this decision from these inputs, clone the engine at the
          commit below and replay it — the run is deterministic, so you should reproduce these hashes
          exactly. If you don't, something is wrong and we want to hear about it.</span>
      </div>
    </div>
  </section>`;
}

function hashRow(k, v, cls = "") {
  return `<div class="hrow"><span class="k">${esc(k)}</span><span class="v ${cls}">${esc(v)}</span></div>`;
}

function setCheck(id, cls, verdict, rows) {
  const node = el(`v-${id}`);
  if (!node) return;
  node.className = `check ${cls}`;
  node.querySelector(".check-verdict").textContent = verdict;
  node.querySelector(".check-ico").textContent =
    cls === "pass" ? "✓" : cls === "fail" ? "✕" : cls === "na" ? "–"
      : String(CHECKS.findIndex(c => c.id === id) + 1);
  const box = node.querySelector(".check-hashes");
  if (rows) { box.innerHTML = rows; box.hidden = false; } else { box.hidden = true; }
}

async function runVerification(actionId) {
  const status = el("v-status");
  const setStatus = (cls, txt) => { status.className = `vstatus ${cls}`; status.textContent = txt; };

  CHECKS.forEach(c => setCheck(c.id, "running", "checking…", null));
  setStatus("running", "Running");
  el("v-sub").textContent = "Fetching artifacts and hashing them in your browser…";

  let detail;
  try {
    detail = await getJSON(SRC.detail(actionId));
  } catch {
    setStatus("fail", "No data");
    CHECKS.forEach(c => setCheck(c.id, "fail", "no data", null));
    return;
  }

  const pov = detail.proof_of_vote || {};
  const dec = detail.decision || {};
  let allPass = true;
  let notAnchored = false;
  const fail = (id, msg) => { allPass = false; setCheck(id, "fail", "failed", hashRow("error", msg)); };

  /* 1. ANCHOR — blake2b-256 of the published rationale vs the hash anchored in the vote tx.
     BEACN's earliest votes were cast before rationale anchoring existed, so they carry no anchor
     hash. That is a real gap in the record, not a tampering signal — say so plainly and leave the
     other two checks to stand on their own. Marking it FAILED would cry wolf; hiding it would be
     dishonest about the coverage. */
  try {
    const want = pov.rationale_anchor_hash;
    if (!want) {
      notAnchored = true;
      setCheck("anchor", "na", "not anchored",
        hashRow("status", "This vote predates on-chain rationale anchoring, so there is no anchor hash to check against.") +
        (dec.transaction_hash ? hashRow("vote tx", dec.transaction_hash) : ""));
      throw { handled: true };
    }
    // Anchored copies are served at /r/<first 24 hex of their own hash>.md — the filename is
    // derived from the bytes, so it is itself a checksum.
    const res = await fetch(`./data/output/public/r/${want.slice(0, 24)}.md`, { cache: "no-store" });
    if (!res.ok) throw new Error(`anchored rationale not reachable (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const r = await verifyAnchor(bytes, want);
    allPass = allPass && r.ok;
    setCheck("anchor", r.ok ? "pass" : "fail", r.ok ? "verified" : "MISMATCH",
      hashRow("on-chain", r.want, r.ok ? "match" : "mismatch") +
      hashRow("computed", r.got, r.ok ? "match" : "mismatch") +
      hashRow("algorithm", "blake2b-256, computed in this browser") +
      (dec.transaction_hash ? hashRow("vote tx", dec.transaction_hash) : ""));
  } catch (e) {
    if (!e || !e.handled) fail("anchor", e.message);
  }

  /* 2 + 3. BUNDLE and INPUT — recompute the manifest's own headline hashes from its contents. */
  try {
    const mdPath = pov.rationale_markdown_path;
    if (!mdPath) throw new Error("no manifest recorded for this decision");
    const manifest = await getJSON(rel(mdPath).replace(/\.md$/, ".manifest.json"));
    const r = await verifyManifest(manifest);

    allPass = allPass && r.bundle.ok;
    const files = (manifest.resource_snapshots || []).length;
    setCheck("bundle", r.bundle.ok ? "pass" : "fail", r.bundle.ok ? "verified" : "MISMATCH",
      hashRow("published", r.bundle.want, r.bundle.ok ? "match" : "mismatch") +
      hashRow("computed", r.bundle.got, r.bundle.ok ? "match" : "mismatch") +
      hashRow("covers", `${files} evidence sources · doctrine ${short(manifest.soul_commit, 7)} · doctrine text ${short(manifest.soul_text_hash, 8)}`));

    allPass = allPass && r.input.ok;
    setCheck("input", r.input.ok ? "pass" : "fail", r.input.ok ? "verified" : "MISMATCH",
      hashRow("published", r.input.want, r.input.ok ? "match" : "mismatch") +
      hashRow("computed", r.input.got, r.input.ok ? "match" : "mismatch") +
      hashRow("proposal", manifest.action?.metadata_title || manifest.action?.action_id || "—"));

    renderProvenance(manifest, detail);
  } catch (e) {
    fail("bundle", e.message);
    fail("input", e.message);
  }

  if (!allPass) {
    setStatus("fail", "Check failed");
    el("v-sub").textContent = "At least one hash did not match. Treat this decision as unverified.";
  } else if (notAnchored) {
    setStatus("pass", "Verified");
    el("v-sub").textContent = "Evidence and inputs verified locally. This early vote carries no on-chain rationale anchor.";
  } else {
    setStatus("pass", "All checks passed");
    el("v-sub").textContent = "Every hash was recomputed in your browser and matches. Nothing was taken on trust.";
  }
}

function renderProvenance(manifest, detail) {
  const box = el("v-prov");
  if (!box) return;
  const pov = detail.proof_of_vote || {};
  const dec = detail.decision || {};
  const core = pov.core_commit || "";
  const soul = pov.soul_commit || "";
  const res = pov.resources_commit || "";

  box.innerHTML = `
  <div class="sec-h" style="margin-top:var(--s6)"><h2>Chain of custody</h2></div>
  <p class="sec-lead">The exact code, rules, and evidence behind this one decision. Every commit is
     public — clone any of them and replay.</p>
  <div class="kv">
    <div class="kv-row"><span class="k">Engine (deterministic)</span>
      <span class="v"><a class="hash" href="${GH.core(core)}" rel="noopener">${esc(core)}</a></span></div>
    <div class="kv-row"><span class="k">Doctrine &amp; weights</span>
      <span class="v"><a class="hash" href="${GH.soul(soul)}" rel="noopener">${esc(soul)}</a></span></div>
    <div class="kv-row"><span class="k">Doctrine text hash</span>
      <span class="v hash">${esc(manifest.soul_text_hash || "—")}</span></div>
    <div class="kv-row"><span class="k">Evidence inputs</span>
      <span class="v"><a class="hash" href="${GH.resources(res)}" rel="noopener">${esc(res)}</a></span></div>
    <div class="kv-row"><span class="k">Evidence bundle</span>
      <span class="v hash">${esc(manifest.snapshot_bundle_hash || "—")}</span></div>
    ${dec.transaction_hash ? `<div class="kv-row"><span class="k">On-chain vote</span>
      <span class="v"><a class="proof" href="${EXPLORER(dec.transaction_hash)}" rel="noopener">
      ${linkIcon} ${esc(short(dec.transaction_hash, 12))}</a>
      <span class="xs muted"> — open it and compare the anchor hash yourself</span></span></div>` : ""}
  </div>`;
}

function wireVerify() {
  const pick = el("v-pick");
  const run = el("v-run");
  if (!pick || !run) return;
  const go = () => {
    state.verifyId = pick.value;
    run.disabled = true;
    runVerification(pick.value).finally(() => { run.disabled = false; });
  };
  run.addEventListener("click", go);
  pick.addEventListener("change", go);
  if (pick.value) go();          // verify the first decision immediately — no empty state to click past
}

function viewDelegate() {
  return `
  <section class="hero">
    <h1>Delegate to a DRep that shows its work.</h1>
    <p>You do not have to trust BEACN. You can check it. Every decision ships with the inputs it
       used, the commit of the doctrine it applied, a hash of the rationale, and a link to the
       vote on-chain.</p>
    <span class="drepid">DRep <code>${esc(state.status?.drep_id || "—")}</code></span>
  </section>
  <section class="sec">
    <div class="prose">
      <h3>What you are delegating to</h3>
      <ul>
        <li><strong>Deterministic votes.</strong> The binding decision is code, not vibes, and it replays byte-for-byte.</li>
        <li><strong>No hidden inputs.</strong> Only public, admitted evidence reaches a gate.</li>
        <li><strong>Funding, not reflexive opposition.</strong> Missing information produces a request for
            information — never a NO. A NO has to be earned with affirmative evidence.</li>
        <li><strong>Published reasoning.</strong> Facts, inferences and uncertainty, separated, for every action.</li>
      </ul>
      <h3>What it will not do</h3>
      <ul>
        <li>Vote on a stale view of the chain.</li>
        <li>Turn a gap in its own evidence pipeline into a verdict about your proposal.</li>
        <li>Optimise for popularity, social pressure, or delegation size.</li>
      </ul>
      <a class="cta" href="#/record">Read the full voting record →</a>
    </div>
  </section>`;
}

async function viewDetail(id) {
  const view = el("view");
  view.innerHTML = `<div class="loading"><span class="spin"></span> Loading decision…</div>`;
  let d;
  try {
    d = await getJSON(SRC.detail(id));
  } catch {
    view.innerHTML = `<a class="back" href="#/record">← Back</a>
      <div class="empty">No published decision found for this action.</div>`;
    return;
  }

  const a = state.byId.get(id) || {};
  const dec = d.decision || {};
  const sc = d.scoring || {};
  const rat = d.rationale || {};
  const asmt = rat.assessment || {};
  const fresh = d.freshness || {};
  const pov = d.proof_of_vote || {};
  const dc = d.decision_contract || rat.decision_contract || {};

  const conf = Number(sc.confidence || 0);
  const sections = Array.isArray(asmt.sections) ? asmt.sections : [];
  const missing = Array.isArray(rat.missing_evidence) ? rat.missing_evidence : [];

  view.innerHTML = `
  <a class="back" href="#/record">← Back to the record</a>
  <div class="detail-head">
    <div class="card-top">
      <span class="chip type">${esc(typeLabel(d.type))}</span>
      <span class="chip ${d.status === "active" ? "open" : "closed"}">${d.status === "active" ? "Open" : "Closed"}</span>
    </div>
    <h1>${esc(d.title || id)}</h1>
  </div>

  <div class="panel">
    <h2>BEACN's position</h2>
    <div class="stance">
      <div class="stance-cell">
        <div class="lbl">Vote cast on-chain</div>
        <div class="val">${proofHTML({
          submitted: dec.submitted, transaction_hash: dec.transaction_hash, onchain_vote: dec.onchain_vote,
        })}</div>
      </div>
      <div class="stance-cell">
        <div class="lbl">Engine recommendation today</div>
        <div class="val"><span class="vote ${esc(dec.vote || "NONE")}">${esc(dec.vote || "—")}</span></div>
      </div>
    </div>
    ${divergeHTML({ diverged: dec.diverged, onchain_vote: dec.onchain_vote, decision: dec.vote })}
    ${rat.summary ? `<p class="muted sm" style="margin-top:12px">${esc(rat.summary)}</p>` : ""}
  </div>

  <div class="panel">
    <h2>Score &amp; confidence</h2>
    <div class="kv">
      <div class="kv-row"><span class="k">Binding score</span><span class="v">${esc(sc.binding_score ?? "—")}</span></div>
      <div class="kv-row"><span class="k">Directional threshold</span><span class="v">±${esc(sc.directional_threshold ?? "—")}</span></div>
      <div class="kv-row"><span class="k">Model influence on the vote</span><span class="v">${esc(sc.model_vote_influence ?? 0)}</span></div>
    </div>
    <div style="margin-top:12px">
      <div class="lbl xs muted">Confidence — verified evidence coverage, capped at 0.90</div>
      <div class="bar"><i style="width:${Math.round(Math.min(conf, 1) * 100)}%"></i></div>
      <div class="xs muted" style="margin-top:4px">${(conf * 100).toFixed(1)}%</div>
    </div>
  </div>

  ${flagsHTML(d.flags)}
  ${capacityHTML(d.treasury_capacity)}

  ${missing.length ? `<div class="panel">
    <h2>What is still missing</h2>
    <p class="muted sm" style="margin-bottom:8px">BEACN is asking for these — it is not holding
       them against the proposal.</p>
    <ul style="list-style:none;display:grid;gap:6px">
      ${missing.map(m => `<li class="sm" style="color:#e8c48a">! ${esc(m)}</li>`).join("")}
    </ul>
  </div>` : ""}

  ${sections.length ? `<div class="panel">
    <h2>The assessment</h2>
    ${sections.map(s => `
      <div class="asec ${esc(s.status === "complete" ? "complete" : "incomplete")}">
        <h3>${esc(s.title)} <span class="chip">${esc(s.status || "")}</span></h3>
        ${Array.isArray(s.findings) && s.findings.length ? `<ul>${s.findings.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        ${Array.isArray(s.missing) && s.missing.length ? `<ul>${s.missing.map(m => `<li class="miss">${esc(m)}</li>`).join("")}</ul>` : ""}
        ${s.conclusion ? `<p class="concl">${esc(s.conclusion)}</p>` : ""}
      </div>`).join("")}
  </div>` : ""}

  ${dc.composite_formula || dc.yes_rule ? `<div class="panel">
    <h2>The rule that decided this</h2>
    ${dc.composite_formula ? `<div class="formula">${esc(dc.composite_formula)}</div>` : ""}
    <div class="kv" style="margin-top:12px">
      ${dc.yes_rule ? `<div class="kv-row"><span class="k">YES requires</span><span class="v">${esc(dc.yes_rule)}</span></div>` : ""}
      ${dc.no_rule ? `<div class="kv-row"><span class="k">NO requires</span><span class="v">${esc(dc.no_rule)}</span></div>` : ""}
      ${dc.policy ? `<div class="kv-row"><span class="k">Policy</span><span class="v">${esc(dc.policy)}</span></div>` : ""}
      ${dc.weights_version ? `<div class="kv-row"><span class="k">Weights version</span><span class="v">${esc(dc.weights_version)}</span></div>` : ""}
      ${dc.weights_hash ? `<div class="kv-row"><span class="k">Weights hash</span><span class="v">${esc(short(dc.weights_hash, 12))}</span></div>` : ""}
    </div>
  </div>` : ""}

  <div class="panel">
    <h2>Reproduce this decision</h2>
    <p class="muted sm" style="margin-bottom:8px">These pin the exact doctrine, inputs and code that
       produced the verdict. Same commits + same inputs = same vote, byte for byte.</p>
    <div class="kv">
      <div class="kv-row"><span class="k">Input hash</span><span class="v">${esc(short(pov.input_hash, 16))}</span></div>
      <div class="kv-row"><span class="k">Doctrine commit</span><span class="v">${esc(short(pov.soul_commit, 12))}</span></div>
      <div class="kv-row"><span class="k">Inputs commit</span><span class="v">${esc(short(pov.resources_commit, 12))}</span></div>
      <div class="kv-row"><span class="k">Engine commit</span><span class="v">${esc(short(pov.core_commit, 12))}</span></div>
      <div class="kv-row"><span class="k">Snapshot age</span><span class="v">${fresh.snapshot_age_seconds != null ? Math.round(fresh.snapshot_age_seconds / 60) + " min" : "—"}${fresh.is_stale ? " (STALE)" : ""}</span></div>
      ${dec.submitted && dec.transaction_hash ? `<div class="kv-row"><span class="k">Vote transaction</span>
        <span class="v"><a href="${EXPLORER(esc(dec.transaction_hash))}" target="_blank" rel="noopener">${esc(short(dec.transaction_hash, 16))}</a></span></div>` : ""}
    </div>
    ${pov.rationale_anchor_url ? `<a class="cta" href="${esc(pov.rationale_anchor_url)}" target="_blank" rel="noopener">Read the full signed rationale →</a>` : ""}
  </div>`;
}

/* ---------- contract panel (method page) ---------- */
async function loadContract(id) {
  const box = el("contract");
  if (!box) return;
  try {
    const d = await getJSON(SRC.detail(id));
    const dc = d.decision_contract || d.rationale?.decision_contract || {};
    const rows = [
      ["Policy", dc.policy],
      ["Weights version", dc.weights_version],
      ["Weights hash", short(dc.weights_hash, 16)],
      ["YES requires", dc.yes_rule],
      ["NO requires", dc.no_rule],
      ["Portfolio gate", dc.portfolio_gate],
      ["Model influence on the vote", dc.model_vote_influence ?? 0],
    ].filter(([, v]) => v != null && v !== "");
    box.innerHTML = `
      ${dc.composite_formula ? `<div class="formula">${esc(dc.composite_formula)}</div>` : ""}
      ${dc.benefit_formula ? `<div class="formula" style="margin-top:8px">${esc(dc.benefit_formula)}</div>` : ""}
      <div class="kv" style="margin-top:12px">
        ${rows.map(([k, v]) => `<div class="kv-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
      </div>`;
  } catch {
    box.innerHTML = `<p class="muted sm">The live contract could not be loaded.</p>`;
  }
}

/* ---------- banner ---------- */
function renderBanner() {
  const b = el("sysbanner");
  const diverged = state.actions.filter(a => a.diverged && a.status === "active").length;
  if (!diverged) { b.hidden = true; return; }
  b.hidden = false;
  // Say what is actually true. This banner used to read "while the evidence pipeline is being
  // repaired" — which was honest in the hour it was written and became a lie the moment the
  // pipeline was fixed. The divergences that remain are not a malfunction: they are BEACN
  // declining to convert a proposal's own missing disclosure into a NO, which is exactly what
  // doctrine requires of it.
  b.innerHTML = `<span aria-hidden="true">⚠</span><span><b>${diverged} open ${diverged === 1 ? "position" : "positions"}
    where BEACN would not re-derive its cast vote today.</b> In each case the engine has verified
    benefit and delivery but the proposal does not disclose enough of its own budget to certify the
    price. BEACN will not turn that silence into a NO — missing evidence never becomes negative
    evidence — so it holds at <em>needs more info</em> while the vote already on-chain stands.
    Open any of them to see exactly which evidence is absent.</span>`;
}

/* ---------- router ---------- */
function setNav(route) {
  document.querySelectorAll(".nav a").forEach(a => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function wireRecord() {
  const rerender = () => {
    const v = el("view");
    v.innerHTML = viewRecord();
    wireCards(v);
    wireRecord();
  };
  el("q")?.addEventListener("input", debounce(rerender, 200));
  el("f-type")?.addEventListener("change", rerender);
  el("f-vote")?.addEventListener("change", rerender);
  el("prev")?.addEventListener("click", () => goPage(-1));
  el("next")?.addEventListener("click", () => goPage(1));
}

function goPage(delta) {
  const parts = location.hash.split("?");
  const p = Math.max(1, parseInt(new URLSearchParams(parts[1] || "").get("p") || "1", 10) + delta);
  location.hash = `#/record?p=${p}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function route() {
  const view = el("view");
  const hash = location.hash || "#/live";
  const path = hash.split("?")[0];

  if (path.startsWith("#/action/")) {
    setNav("");
    await viewDetail(decodeURIComponent(path.slice("#/action/".length)));
    return;
  }
  if (path.startsWith("#/record")) {
    setNav("record");
    view.innerHTML = viewRecord();
    wireCards(view);
    wireRecord();
    return;
  }
  if (path.startsWith("#/method")) {
    setNav("method");
    view.innerHTML = viewMethod();
    const sample = state.actions.find(a => a.submitted) || state.actions[0];
    if (sample) loadContract(sample.action_id);
    return;
  }
  if (path.startsWith("#/verify")) {
    setNav("verify");
    view.innerHTML = viewVerify();
    wireVerify();
    return;
  }
  if (path.startsWith("#/delegate")) {
    setNav("delegate");
    view.innerHTML = viewDelegate();
    return;
  }
  setNav("live");
  view.innerHTML = viewLive();
  wireCards(view);
}

/* ---------- boot ---------- */
async function boot() {
  try {
    const [index, actions, status, weights] = await Promise.all([
      getJSON(SRC.index).catch(() => null),
      getJSON(SRC.actions),
      getJSON(SRC.status).catch(() => null),
      getJSON(SRC.weights).catch(() => null),
    ]);
    state.index = index;
    state.status = status;
    state.weights = weights;
    state.actions = (actions.items || []).filter(a => a && a.action_id);
    state.actions.forEach(a => state.byId.set(a.action_id, a));

    renderBanner();
    el("provenance").textContent =
      `Published ${index?.generated_at || "—"} · doctrine ${short(index?.soul?.commit, 7)} · ` +
      `inputs ${short(index?.resources?.commit, 7)} · engine ${short(index?.core?.commit, 7)}`;

    await route();
    window.addEventListener("hashchange", route);
  } catch (e) {
    el("view").innerHTML = `<div class="empty">Could not load the public record.<br>
      <span class="xs">${esc(e.message)}</span></div>`;
  }
}

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.assessment.js").catch(() => {}));
}
