/* BEACN DRep — public transparency platform.
   View-only. No decision logic lives here; every number is read from the machine-generated
   public artifacts. The one rule this file must never break: `decision` is what the engine
   RECOMMENDS today, `onchain_vote` is what BEACN actually CAST. They can differ, and the
   site must always show which is which. */

const SRC = {
  status:    "./status.json",
  index:     "./data/output/public/index.json",
  actions:   "./data/output/public/actions.json",
  detail:    id => `./data/output/public/actions/${encodeURIComponent(id)}.json`,
};

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

const state = { index: null, actions: [], status: null, byId: new Map() };

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
  return `<span class="diverge"><b>Position under review.</b> BEACN voted
    <b>${esc(a.onchain_vote)}</b> on-chain; on today's evidence the engine would say
    <b>${esc(a.decision)}</b>. The cast vote stands until a revision clears the anti-churn policy.</span>`;
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
    <h1>Cardano governance, decided in the open.</h1>
    <p>BEACN is an autonomous DRep. Every vote is produced by deterministic, replayable rules
       over public evidence — then published with its reasoning and its on-chain proof. Nothing
       is decided in private, and nothing here is a claim you cannot check yourself.</p>
    <span class="drepid">DRep <code>${esc(state.status?.drep_id || "—")}</code></span>
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

function viewMethod() {
  // Read the live weighting contract off a real decision rather than restating it by hand,
  // so this page cannot drift from the engine that actually votes.
  const sample = state.actions.find(a => a.submitted) || state.actions[0];
  return `
  <section class="hero">
    <h1>How a vote is made.</h1>
    <p>The binding decision is pure deterministic Python over declared inputs. A language model
       helps read documents and explain outcomes in plain English — it can never set, change, or
       veto a vote. That boundary is the whole design.</p>
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
  b.innerHTML = `<span aria-hidden="true">⚠</span><span><b>${diverged} open ${diverged === 1 ? "position is" : "positions are"}
    under review.</b> While the evidence pipeline is being repaired, the engine's current
    recommendation differs from the vote already on-chain. The cast vote stands — missing evidence
    never retracts a vote.</span>`;
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
    const [index, actions, status] = await Promise.all([
      getJSON(SRC.index).catch(() => null),
      getJSON(SRC.actions),
      getJSON(SRC.status).catch(() => null),
    ]);
    state.index = index;
    state.status = status;
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
