"use strict";

const PATHS = {
  status: "./status.json",
  actions: "./data/output/public/actions.json",
  rationales: "./data/output/public/rationales.json",
  statements: "./data/output/public/statements.json",
  detail: id => `./data/output/public/actions/${encodeURIComponent(id)}.json`
};
const CARDANO_START = Date.parse("2017-09-23T21:44:51Z");
const EPOCH_MS = 5 * 24 * 60 * 60 * 1000;
const DREP_FALLBACK = "drep1yg3fzjm63hjg37k3rtdt7wx0mgmn303lwv2s50xxkjzsv5qfhynxg";
const state = {
  status: null, actions: [], rationale: new Map(), statements: new Map(), details: new Map(),
  verdict: "ALL", query: "", archiveStatus: "ALL", loading: false
};
const app = document.getElementById("app");
const refreshButton = document.getElementById("refresh-button");
const refreshProgress = document.getElementById("refresh-progress");
const connectionDot = document.getElementById("connection-dot");
let pullStart = 0;
let pullDistance = 0;
let activeListView = "";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const attr = value => esc(value).replace(/`/g, "&#96;");
const compact = value => String(value || "").replace(/\s+/g, " ").trim();
const firstSentence = value => {
  const text = compact(value);
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return match ? match[1] : text;
};
const dateText = iso => {
  if (!iso) return "Not published";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(d);
};
const relative = iso => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};
const cardanoscan = {
  action: id => `https://cardanoscan.io/govAction/${encodeURIComponent(id)}`,
  tx: hash => `https://cardanoscan.io/transaction/${encodeURIComponent(hash)}`,
  drep: id => `https://cardanoscan.io/drep/${encodeURIComponent(id)}`
};
const repoCommit = (repo, hash) => hash ? `https://github.com/BEACNpool/${repo}/commit/${encodeURIComponent(hash)}` : "";
const localPath = path => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const clean = String(path).replace(/^\/+/, "");
  return clean.startsWith("data/") ? `./${clean}` : `./data/output/public/${clean}`;
};
const verdictKey = value => {
  const v = String(value || "").toUpperCase().replace(/\s+/g, "_");
  if (v.includes("NEEDS") || v.includes("MORE_INFO")) return "NEEDS_MORE_INFO";
  if (v.includes("ABSTAIN")) return "ABSTAIN";
  if (v.includes("YES")) return "YES";
  if (v.includes("NO")) return "NO";
  return v || "PENDING";
};
const verdictMeta = value => ({
  YES: { label: "Yes", cls: "v-yes", color: "var(--green)" },
  NO: { label: "No", cls: "v-no", color: "var(--red)" },
  ABSTAIN: { label: "Abstain", cls: "v-abstain", color: "var(--slate)" },
  NEEDS_MORE_INFO: { label: "Needs info", cls: "v-info", color: "var(--amber)" },
  PENDING: { label: "Pending", cls: "v-abstain", color: "var(--slate)" }
}[verdictKey(value)] || { label: compact(value) || "Pending", cls: "v-abstain", color: "var(--slate)" });
const routeFor = id => `#/action/${encodeURIComponent(id)}`;
const summaryFor = id => {
  const rationale = state.rationale.get(id);
  const binding = rationale?.decision ? verdictKey(rationale.decision) : "";
  const statement = state.statements.get(id);
  // Convenience statements can drift from the binding deterministic record. Only
  // surface a statement when it agrees with the binding verdict (or none is known);
  // otherwise fall back to the deterministic rationale so the site never contradicts itself.
  if (statement?.statement && (!binding || !statement.decision || verdictKey(statement.decision) === binding)) {
    return statement.statement;
  }
  return compact(rationale?.summary || "").replace(/^Vote:\s*[A-Z_]+\.\s*/i, "");
};
const currentMap = () => new Map((state.status?.actions || []).filter(a => a.cip129_action_id).map(a => [a.cip129_action_id, a]));
const epochSnapshot = () => {
  const elapsed = Math.max(0, Date.now() - CARDANO_START);
  return { epoch: Math.floor(elapsed / EPOCH_MS), within: elapsed % EPOCH_MS };
};
const recordFor = item => {
  const live = currentMap().get(item.action_id) || {};
  return {
    ...item,
    cip129_action_id: item.action_id,
    decision: verdictKey(item.decision || live.recommendation || live.our_vote),
    transaction_hash: live.transaction_hash || null,
    expires_after_epoch: live.expires_after_epoch,
    proposed_in_epoch: live.proposed_in_epoch,
    summary: summaryFor(item.action_id)
  };
};
const currentRecords = () => {
  const byId = new Map(state.actions.map(item => [item.action_id, item]));
  return (state.status?.actions || []).filter(item => item.cip129_action_id).map(live => {
    const record = byId.get(live.cip129_action_id) || {};
    return {
      ...record,
      ...live,
      action_id: live.cip129_action_id,
      cip129_action_id: live.cip129_action_id,
      decision: verdictKey(live.recommendation || live.our_vote || record.decision),
      summary: summaryFor(live.cip129_action_id)
    };
  });
};
const expiryText = expiry => {
  if (expiry === null || expiry === undefined || expiry === "") return "";
  const remaining = Number(expiry) - epochSnapshot().epoch;
  if (remaining < 0) return `expired ${Math.abs(remaining)} epoch${Math.abs(remaining) === 1 ? "" : "s"} ago`;
  if (remaining === 0) return "expires this epoch";
  return `${remaining} epoch${remaining === 1 ? "" : "s"} remaining`;
};
const showToast = message => {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove("show"), 1800);
};
const copyText = async text => {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  } catch {
    showToast("Copy failed");
  }
};

async function fetchJSON(url, required = false) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    if (required) throw new Error(`${url} returned HTTP ${response.status}`);
    return null;
  }
  return response.json();
}

async function loadFeeds(force = false) {
  if (state.loading) return;
  if (state.status && !force) return;
  state.loading = true;
  refreshButton.classList.add("spinning");
  refreshProgress.style.width = "38%";
  try {
    const [status, actions, rationales, statements] = await Promise.all([
      fetchJSON(PATHS.status, true),
      fetchJSON(PATHS.actions, true),
      fetchJSON(PATHS.rationales),
      fetchJSON(PATHS.statements)
    ]);
    state.status = status;
    state.actions = actions?.items || [];
    state.rationale = new Map((rationales?.items || []).map(item => [item.action_id, item]));
    state.statements = new Map(Object.entries(statements || {}).map(([id, value]) => [id, value]));
    connectionDot.className = "connection-dot online";
    connectionDot.title = "Feeds online";
    refreshProgress.style.width = "100%";
  } catch (error) {
    connectionDot.className = "connection-dot offline";
    connectionDot.title = "Using cached data if available";
    if (!state.status) throw error;
    showToast("Offline: showing cached data");
  } finally {
    state.loading = false;
    refreshButton.classList.remove("spinning");
    setTimeout(() => { refreshProgress.style.width = "0"; }, 300);
  }
}

function proposalCard(item) {
  const v = verdictMeta(item.decision);
  return `<a class="proposal-card" href="${routeFor(item.cip129_action_id)}">
    <div class="proposal-top">
      <h3 class="proposal-title">${esc(item.title || "Governance action")}</h3>
      <span class="type-pill">${esc(item.type || "Unknown type")}</span>
    </div>
    <span class="verdict ${v.cls}">${esc(v.label)}</span>
    <p class="summary-line">${esc(firstSentence(item.summary) || "Open the decision record to inspect the published rationale.")}</p>
    <span class="reason-link">Full reasoning <span aria-hidden="true">→</span></span>
    <div class="proposal-meta">
      <span>${esc(item.status || "recorded")}</span>
      ${item.expires_after_epoch ? `<span class="${Number(item.expires_after_epoch) - epochSnapshot().epoch <= 1 ? "urgent" : ""}">${esc(expiryText(item.expires_after_epoch))} · epoch ${esc(item.expires_after_epoch)}</span>` : ""}
      ${item.transaction_hash ? "<span>on-chain vote</span>" : "<span>decision record</span>"}
    </div>
  </a>`;
}

function viewHeader(eyebrow, title, subtitle) {
  return `<div class="view-head"><div class="eyebrow">${esc(eyebrow)}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>`;
}

const isActive = item => String(item?.status || "").toLowerCase() === "active";
const activeActionIds = () => new Set(state.actions.filter(isActive).map(item => item.action_id));

function activeRecords() {
  return state.actions
    .filter(isActive)
    .map(item => ({
      ...item,
      cip129_action_id: item.action_id,
      decision: verdictKey(item.decision),
      summary: summaryFor(item.action_id),
      reviewedAt: item.published_at || item.detected_at || ""
    }))
    .sort((a, b) =>
      Number(new Date(b.detected_at || 0)) - Number(new Date(a.detected_at || 0)) ||
      String(a.title || "").localeCompare(String(b.title || ""))
    );
}

const DECK_FLOW = ["Intake", "Evidence", "Verdict"];

function deckCard(item, index) {
  const v = verdictMeta(item.decision);
  const summary = firstSentence(item.summary) || "Open the decision record to inspect the published rationale, review tree, and on-chain proof.";
  const reviewed = item.reviewedAt ? `Reviewed ${relative(item.reviewedAt)}` : "Awaiting publication";
  return `<a class="deck-card" data-index="${index}" style="--vc:${v.color}" href="${routeFor(item.cip129_action_id)}">
    <span class="deck-card-glow" aria-hidden="true"></span>
    <div class="deck-card-top">
      <span class="type-pill">${esc(item.type || "Governance")}</span>
      <span class="live-pill"><i></i> Active</span>
    </div>
    <div class="deck-verdict ${v.cls}">
      <span class="deck-verdict-ring" aria-hidden="true"></span>
      <strong>${esc(v.label)}</strong>
      <small>BEACN DRep verdict</small>
    </div>
    <h3 class="deck-title">${esc(item.title || "Governance action")}</h3>
    <p class="deck-summary">${esc(summary)}</p>
    <div class="deck-flow" aria-hidden="true">
      ${DECK_FLOW.map((step, i) => `<span class="deck-flow-step"><i>${i + 1}</i>${step}</span>`).join('<span class="deck-flow-line"></span>')}
    </div>
    <div class="deck-card-foot">
      <span class="deck-reviewed">${esc(reviewed)}</span>
      <span class="deck-open">Open decision flow <span aria-hidden="true">→</span></span>
    </div>
  </a>`;
}

function renderHome() {
  const status = state.status || {};
  const check = status.last_check || {};
  const all = activeRecords();
  const counts = { ALL: all.length, YES: 0, NO: 0, ABSTAIN: 0, NEEDS_MORE_INFO: 0 };
  all.forEach(r => { counts[verdictKey(r.decision)] = (counts[verdictKey(r.decision)] || 0) + 1; });
  const visible = state.verdict === "ALL"
    ? all
    : all.filter(r => verdictKey(r.decision) === state.verdict);
  const { epoch, within } = epochSnapshot();
  const held = all.filter(r => verdictKey(r.decision) === "NEEDS_MORE_INFO").length;
  const directional = all.filter(r => ["YES", "NO"].includes(verdictKey(r.decision))).length;
  const pad = n => String(n).padStart(2, "0");
  const deck = visible.length
    ? `<div class="deck-wrap">
        <button class="deck-nav prev" type="button" aria-label="Previous proposal"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="deck" id="deck">${visible.map(deckCard).join("")}</div>
        <button class="deck-nav next" type="button" aria-label="Next proposal"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
      <div class="deck-progress">
        <span class="deck-counter" id="deck-counter">${pad(1)} / ${pad(visible.length)}</span>
        <div class="deck-dots" id="deck-dots">${visible.map((_, i) => `<button type="button" class="${i === 0 ? "active" : ""}" aria-label="Go to proposal ${i + 1}"></button>`).join("")}</div>
        <span class="deck-hint">Swipe · tap a card to open</span>
      </div>`
    : '<div class="card empty">No active proposals match this filter right now.</div>';
  app.innerHTML = `<section class="view">
    ${viewHeader("Active governance", "Live proposals", "Every governance action currently open for DRep voting. Swipe the deck, then open any card to follow the decision flow from public evidence to the BEACN verdict and on-chain proof.")}
    <article class="card epoch-dashboard">
      <div class="epoch-dashboard-top">
        <div>
          <span class="live-pill"><i></i> Epoch in progress</span>
          <div class="epoch-number">Epoch <strong id="epoch-number">${epoch}</strong></div>
        </div>
        <div class="epoch-remaining"><span>Time until next epoch</span><strong id="epoch-countdown">calculating…</strong></div>
      </div>
      <div class="progress epoch-progress"><span id="epoch-progress" style="width:${within / EPOCH_MS * 100}%"></span></div>
      <div class="epoch-scale"><span>Epoch ${epoch} began</span><span>Epoch ${epoch + 1} begins</span></div>
      <div class="epoch-stats">
        <div><strong>${all.length}</strong><span>Active proposals</span></div>
        <div><strong>${directional}</strong><span>Directional votes</span></div>
        <div><strong>${held}</strong><span>Awaiting evidence</span></div>
        <div><strong>${pad(epoch)}</strong><span>Current epoch</span></div>
      </div>
    </article>

    <div class="live-status-line">
      <span>${esc(check.summary || "Loading the latest governance snapshot.")}</span>
      <small>${status.generated_at ? `Checked ${esc(relative(status.generated_at))}` : ""}</small>
    </div>

    <div class="filters live-filters">
      <div class="chips">
        ${[
          ["ALL", "All"], ["YES", "Yes"], ["NO", "No"], ["ABSTAIN", "Abstain"], ["NEEDS_MORE_INFO", "Needs info"]
        ].map(([key, label]) => `<button class="chip ${state.verdict === key ? "active" : ""}" type="button" data-verdict="${key}">${label} ${counts[key] || 0}</button>`).join("")}
      </div>
    </div>
    <div class="deck-heading"><span>Showing ${visible.length} of ${all.length} active proposals</span></div>
    ${deck}
  </section>`;
  bindProposalFilters(renderHome);
  bindDeck();
  updateEpochClock();
}

function bindDeck() {
  const deck = document.getElementById("deck");
  if (!deck) return;
  const cards = [...deck.querySelectorAll(".deck-card")];
  if (!cards.length) return;
  const counter = document.getElementById("deck-counter");
  const dots = [...document.querySelectorAll("#deck-dots button")];
  const pad = n => String(n).padStart(2, "0");
  let active = -1;
  const apply = () => {
    const center = deck.scrollLeft + deck.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    cards.forEach(card => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardCenter - center);
      const norm = Math.min(1, dist / ((card.offsetWidth || 1) * 0.9));
      card.style.setProperty("--p", norm.toFixed(3));
      if (dist < bestDist) { bestDist = dist; best = cards.indexOf(card); }
    });
    cards.forEach((card, i) => card.classList.toggle("is-active", i === best));
    if (best !== active) {
      active = best;
      if (counter) counter.textContent = `${pad(active + 1)} / ${pad(cards.length)}`;
      dots.forEach((d, i) => d.classList.toggle("active", i === active));
    }
  };
  let raf = 0;
  deck.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  }, { passive: true });
  const goTo = i => {
    const card = cards[Math.max(0, Math.min(cards.length - 1, i))];
    if (card) deck.scrollTo({ left: card.offsetLeft - (deck.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
  };
  document.querySelector(".deck-nav.prev")?.addEventListener("click", () => goTo(active - 1));
  document.querySelector(".deck-nav.next")?.addEventListener("click", () => goTo(active + 1));
  dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));

  let down = false;
  let startX = 0;
  let startLeft = 0;
  let moved = 0;
  deck.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") return;
    down = true;
    startX = event.clientX;
    startLeft = deck.scrollLeft;
    moved = 0;
    deck.setPointerCapture(event.pointerId);
    deck.classList.add("dragging");
  });
  deck.addEventListener("pointermove", event => {
    if (!down) return;
    const dx = event.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    deck.scrollLeft = startLeft - dx;
  });
  const endDrag = event => {
    if (!down) return;
    down = false;
    deck.classList.remove("dragging");
    try { deck.releasePointerCapture(event.pointerId); } catch (_) {}
    goTo(active);
  };
  deck.addEventListener("pointerup", endDrag);
  deck.addEventListener("pointercancel", endDrag);
  deck.addEventListener("click", event => { if (moved > 8) event.preventDefault(); }, true);
  apply();
}

function distribution(records) {
  const counts = { YES: 0, NO: 0, ABSTAIN: 0, NEEDS_MORE_INFO: 0 };
  records.forEach(r => { counts[verdictKey(r.decision)] = (counts[verdictKey(r.decision)] || 0) + 1; });
  const total = Math.max(1, records.length);
  return `<div class="distribution" aria-label="Verdict distribution">
    ${Object.entries(counts).filter(([, count]) => count).map(([key, count]) =>
      `<span title="${verdictMeta(key).label}: ${count}" style="width:${count / total * 100}%;background:${verdictMeta(key).color}"></span>`
    ).join("")}
  </div><div class="distribution-label"><span>Verdict distribution</span><span>${records.length} reviewed</span></div>`;
}

function renderProposals() {
  const all = state.actions.map(recordFor);
  const archived = all.filter(r => !isActive(r));
  const scoped = state.archiveStatus === "ALL"
    ? archived
    : archived.filter(r => String(r.status || "").toUpperCase() === state.archiveStatus);
  const counts = { ALL: scoped.length, YES: 0, NO: 0, ABSTAIN: 0, NEEDS_MORE_INFO: 0 };
  scoped.forEach(r => { counts[verdictKey(r.decision)] = (counts[verdictKey(r.decision)] || 0) + 1; });
  const q = state.query.trim().toLowerCase();
  const visible = scoped.filter(r =>
    (state.verdict === "ALL" || verdictKey(r.decision) === state.verdict) &&
    (!q || `${r.title} ${r.type} ${r.action_id}`.toLowerCase().includes(q))
  );
  app.innerHTML = `<section class="view">
    ${viewHeader("Concluded governance", "Proposal archive", `Browse ${archived.length} expired and enacted governance actions. Every record preserves the request, verdict, structured reasons, and proof.`)}
    <div class="filters">
      <div class="segmented archive-segmented" role="group" aria-label="Archive status">
        ${[
          ["ALL", `All (${archived.length})`],
          ["EXPIRED", `Expired (${archived.filter(r => String(r.status).toLowerCase() === "expired").length})`],
          ["ENACTED", `Enacted (${archived.filter(r => String(r.status).toLowerCase() === "enacted").length})`]
        ].map(([key, label]) => `<button type="button" data-archive-status="${key}" class="${state.archiveStatus === key ? "active" : ""}">${label}</button>`).join("")}
      </div>
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input class="search" id="proposal-search" type="search" value="${attr(state.query)}" placeholder="Search title, type, or action ID" aria-label="Search proposals" />
      </div>
      <div class="chips">
        ${[
          ["ALL", "All"], ["YES", "Yes"], ["NO", "No"], ["ABSTAIN", "Abstain"], ["NEEDS_MORE_INFO", "Needs info"]
        ].map(([key, label]) => `<button class="chip ${state.verdict === key ? "active" : ""}" type="button" data-verdict="${key}">${label} ${counts[key] || 0}</button>`).join("")}
      </div>
    </div>
    ${distribution(scoped)}
    <div class="result-count">Showing ${visible.length} of ${scoped.length}</div>
    <div class="card-list" id="proposal-results">${visible.map(proposalCard).join("") || '<div class="card empty">No proposals match these filters.</div>'}</div>
  </section>`;
  bindProposalFilters();
}

function bindProposalFilters(render = renderProposals) {
  document.querySelectorAll("[data-archive-status]").forEach(button => button.addEventListener("click", () => {
    state.archiveStatus = button.dataset.archiveStatus;
    state.verdict = "ALL";
    render();
  }));
  document.querySelectorAll("[data-verdict]").forEach(button => button.addEventListener("click", () => {
    state.verdict = button.dataset.verdict;
    render();
  }));
  document.getElementById("proposal-search")?.addEventListener("input", event => {
    state.query = event.target.value;
    render();
    const input = document.getElementById("proposal-search");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
}

function renderMethod() {
  const drep = state.status?.drep_id || DREP_FALLBACK;
  app.innerHTML = `<section class="view">
    ${viewHeader("Method and trust", "How BEACN earns a vote", "A good DRep page has one job here: show the path from public evidence to a public vote, then make each decision easy to verify.")}

    <article class="card method-hero">
      <div class="method-kicker">First principles</div>
      <h2>The site should answer three questions.</h2>
      <div class="method-question-grid">
        <div><strong>What is live?</strong><span>Handled by Live: current proposals, epoch timing, and urgent evidence holds.</span></div>
        <div><strong>What happened?</strong><span>Handled by Archive: expired and enacted decisions with preserved reasoning.</span></div>
        <div><strong>Why trust it?</strong><span>Handled here: rules, input boundaries, replay path, and delegation safety.</span></div>
      </div>
    </article>

    <article class="card pipeline-card">
      <h2>Decision pipeline</h2>
      <p class="verify-copy">Each vote moves through the same public chain. The website renders the result; it does not decide anything.</p>
      <div class="pipeline-steps">
        <div><b>1</b><strong>Proposal</strong><span>Governance action and anchor material are fetched from declared public sources.</span></div>
        <div><b>2</b><strong>Admitted evidence</strong><span>Only resource-registry inputs can influence a rationale.</span></div>
        <div><b>3</b><strong>Doctrine</strong><span>Public soul rules set values, gates, and scoring boundaries.</span></div>
        <div><b>4</b><strong>Engine</strong><span>Core applies deterministic checks and produces the verdict.</span></div>
        <div><b>5</b><strong>Proof</strong><span>Hashes, commits, rationale anchors, and transactions are published per action.</span></div>
      </div>
    </article>

    <div class="method-grid">
      <article class="card gate-card"><h2>Safety gates run first</h2><p class="verify-copy">Stale data, missing baseline evidence, an unknown action type, constitutional risk, or an incomplete treasury dossier blocks a confident directional vote. Speed never outranks protocol safety or evidence quality.</p></article>
      <article class="card gate-card"><h2>Verification lives on each action</h2><p class="verify-copy">Hashes and receipts only matter when attached to the decision they prove. Open any proposal from Live or Archive to inspect source snapshots, rationale markdown, commits, and on-chain vote transactions.</p></article>
    </div>

    <div class="section-title"><h2>Verdict meanings</h2></div>
    <div class="rule-grid compact-rules">
      <article class="card rule-card yes"><h2 class="v-yes">Yes</h2><p>Evidence is complete, safeguards are credible, public benefit is demonstrated, and the weighted score clears the positive threshold.</p></article>
      <article class="card rule-card no"><h2 class="v-no">No</h2><p>Demonstrated downside, weak safeguards, constitutional conflict, or unsustainable cost outweighs the claimed benefit.</p></article>
      <article class="card rule-card abstain"><h2 class="v-abstain">Abstain</h2><p>A directional vote cannot be justified from admitted evidence. This records participation without pretending confidence.</p></article>
      <article class="card rule-card info"><h2 class="v-info">Needs more info</h2><p>A proposal is reviewable, but required evidence is missing. The detail page names what would change the vote.</p></article>
    </div>

    <article class="card hierarchy">
      <h2>Values hierarchy</h2>
      <p class="subtitle">When values conflict, the higher public value wins in this fixed order.</p>
      <ol><li>Constitutional integrity and protocol safety</li><li>Treasury stewardship</li><li>Evidence quality</li><li>Public benefit</li><li>Speed</li></ol>
    </article>

    <article class="card verify-hero">
      <h2>Verify the system</h2>
      <p class="verify-copy">Clone the repos, inspect the public doctrine and admitted resources, then replay a published decision from the action detail receipts. Generated plain-English statements are convenience text; the deterministic record is binding.</p>
      <div class="repo-row">
        <a href="https://github.com/BEACNpool/beacn-drep-core" target="_blank" rel="noopener">Core<small>Deterministic engine</small></a>
        <a href="https://github.com/BEACNpool/beacn-drep-soul" target="_blank" rel="noopener">Soul<small>Doctrine and values</small></a>
        <a href="https://github.com/BEACNpool/beacn-drep-resources" target="_blank" rel="noopener">Resources<small>Admitted public data</small></a>
        <a href="https://github.com/BEACNpool/beacn-drep-web" target="_blank" rel="noopener">Web<small>Published record</small></a>
      </div>
    </article>

    <div class="section-title"><h2>Philosophy and doctrine</h2></div>
    <div class="link-grid">
      ${doctrineLinks.map(([title, note, file]) => `<a class="card link-card" href="https://github.com/BEACNpool/beacn-drep-soul/blob/main/${file}" target="_blank" rel="noopener"><span><strong>${esc(title)}</strong><small>${esc(note)}</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>`).join("")}
    </div>
    <article class="card delegate-card">
      <div class="eyebrow">Delegate</div>
      <h2>Your ADA never leaves your wallet.</h2>
      <p class="verify-copy">Delegation assigns governance voting power only. You keep custody and can change your DRep at any time.</p>
      <div class="drep-id" id="drep-id">${esc(drep)}</div>
      <div class="button-row">
        <button class="button" id="copy-drep" type="button">Copy DRep ID</button>
        <a class="button secondary" href="${cardanoscan.drep(drep)}" target="_blank" rel="noopener">View on Cardanoscan</a>
      </div>
    </article>
  </section>`;
  document.getElementById("copy-drep")?.addEventListener("click", () => copyText(drep));
}

const doctrineLinks = [
  ["Governance philosophy", "The constitutional and evidence-first foundation", "GOVERNANCE_PHILOSOPHY.md"],
  ["Why delegate", "The case for BEACN and its honest limits", "WHY_DELEGATE.md"],
  ["Values hierarchy", "How conflicts between priorities are resolved", "values_hierarchy.md"],
  ["Scoring weights", "The public deterministic weighting contract", "scoring_weights.json"],
  ["Treasury spending", "Budget, milestones, concentration, and sustainability", "treasury_spending_doctrine.md"],
  ["Parameter changes", "Safety rules for protocol parameter proposals", "parameter_change_doctrine.md"],
  ["Hard forks", "Readiness and protocol upgrade requirements", "hardfork_doctrine.md"],
  ["Committee updates", "Constitutional committee evaluation rules", "committee_update_doctrine.md"],
  ["Info actions", "How non-binding governance signals are assessed", "info_action_doctrine.md"],
  ["Constitutional amendments", "Requirements for changing the constitution", "constitutional_amendment_doctrine.md"]
];

function detailSkeleton(backRoute) {
  app.innerHTML = `<section class="view"><div class="detail-head"><a class="icon-button back-button" href="${backRoute}" aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></a><span>Loading decision record…</span></div><div class="skeleton hero-skeleton"></div><div class="skeleton card-skeleton" style="margin-top:14px"></div><div class="skeleton card-skeleton" style="margin-top:14px"></div></section>`;
}

function proofRow(label, value, link = "") {
  if (value === undefined || value === null || value === "") return "";
  return `<div class="proof-row"><span>${esc(label)}</span>${link ? `<a href="${attr(link)}" target="_blank" rel="noopener"><code>${esc(value)}</code></a>` : `<code>${esc(value)}</code>`}</div>`;
}

function extractedAmount(detail) {
  for (const value of [detail.amount, detail.requested_amount, detail.treasury_amount, detail.withdrawal_amount]) {
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  const titleMatch = String(detail.title || "").match(/(?:withdraw|request(?:ing)?)\s+([₳$€£]?\s?[\d,.]+\s*(?:ADA|₳)?)/i);
  return titleMatch ? titleMatch[1].trim() : "";
}

function renderAssessmentTree(assessment) {
  const sections = assessment?.sections || [];
  if (!sections.length) return "";
  return `<article class="card detail-section">
    <h2><span>03</span>Review tree</h2>
    <p class="subtitle">The proposal must pass through these assessment steps before the final vote is defensible.</p>
    <div class="assessment-status">Assessment status: <strong>${esc(assessment.overall_status || "unknown")}</strong></div>
    <div class="assessment-list">
      ${sections.map(section => `<div class="assessment-item ${attr(section.status || "")}">
        <div class="assessment-item-head"><strong>${esc(section.title || "Assessment")}</strong><span>${esc(section.status || "unknown")}</span></div>
        ${section.conclusion ? `<p>${esc(section.conclusion)}</p>` : ""}
        ${(section.findings || []).length ? `<ul>${section.findings.slice(0, 6).map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
        ${(section.missing || []).length ? `<div class="missing-list"><b>Missing</b>${section.missing.slice(0, 6).map(item => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
      </div>`).join("")}
    </div>
  </article>`;
}

async function renderDetail(id) {
  document.body.classList.add("detail-open");
  const backRoute = activeActionIds().has(id) ? "#/home" : "#/proposals";
  detailSkeleton(backRoute);
  let detail = state.details.get(id);
  if (!detail) {
    try {
      detail = await fetchJSON(PATHS.detail(id), true);
      state.details.set(id, detail);
    } catch (error) {
      app.innerHTML = `<section class="view"><div class="detail-head"><a class="icon-button back-button" href="${backRoute}" aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></a><span>Decision record</span></div><div class="card empty"><h2>Detail unavailable</h2><p>${esc(error.message)}</p><a href="${cardanoscan.action(id)}" target="_blank" rel="noopener">Open action on Cardanoscan</a></div></section>`;
      return;
    }
  }
  if (parseRoute().id !== id) return;
  const listRecord = state.actions.find(item => item.action_id === id) || {};
  const live = currentMap().get(id) || {};
  const evidence = detail.proposal_evidence || {};
  const rationale = detail.rationale || {};
  const assessment = rationale.assessment || {};
  const proof = detail.proof_of_vote || detail.reproducibility || {};
  const reproducibility = detail.reproducibility || {};
  const decision = detail.decision || {};
  const scoring = detail.scoring || {};
  const verdict = verdictMeta(decision.vote || proof.vote || listRecord.decision);
  const statement = summaryFor(id) || rationale.summary || "No plain-language statement has been published for this action.";
  const amount = extractedAmount(detail);
  const snapshot = localPath(evidence.download_path || listRecord.proposal_path);
  const rationaleMarkdown = localPath(proof.rationale_markdown_path || rationale.markdown_path);
  const confidence = Number(proof.confidence);
  const confidenceText = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "—";
  const score = Number.isFinite(Number(proof.score)) ? Number(proof.score).toFixed(2) : "—";
  const reasonCode = detail.reason_code || rationale.reason_code || rationale.summary_raw || "Published deterministic rationale";
  const missing = rationale.missing_evidence || [];
  app.innerHTML = `<section class="view">
    <div class="detail-head"><a class="icon-button back-button" href="${backRoute}" aria-label="Back to proposals"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></a><span>${esc(id)}</span></div>
    <article class="card detail-hero">
      <div class="detail-meta"><span class="status-pill">${esc(detail.status || listRecord.status || "recorded")}</span><span class="type-pill">${esc(detail.type || listRecord.type || "Unknown type")}</span></div>
      <h1>${esc(detail.title || listRecord.title || "Governance action")}</h1>
      <span class="verdict ${verdict.cls}">${esc(verdict.label)}</span>
      <div class="detail-links"><a href="${cardanoscan.action(id)}" target="_blank" rel="noopener">Action on Cardanoscan ↗</a>${decision.transaction_hash ? `<a href="${cardanoscan.tx(decision.transaction_hash)}" target="_blank" rel="noopener">Vote transaction ↗</a>` : ""}</div>
    </article>

    <article class="card detail-section">
      <h2><span>01</span>The request</h2>
      <p class="subtitle">The proposal material that was admitted and analyzed.</p>
      ${amount ? `<div class="metric-grid"><div class="metric"><span>Requested amount</span><strong>${esc(amount)}</strong></div></div>` : ""}
      ${evidence.available ? `<pre class="preview">${esc(evidence.preview || "A proposal snapshot is available, but no preview was published.")}</pre>` : `<p class="missing">The proposal source was not available in this published record.</p>`}
      <div class="detail-links">
        ${evidence.source_anchor_url ? `<a href="${attr(evidence.source_anchor_url)}" target="_blank" rel="noopener">Original proposal / anchor ↗</a>` : ""}
        ${snapshot ? `<a href="${attr(snapshot)}" target="_blank" rel="noopener">Download public snapshot ↗</a>` : ""}
      </div>
      <div class="proof-list">
        ${proofRow("Content type", evidence.content_type)}
        ${proofRow("Fetched", evidence.fetched_at_utc)}
        ${proofRow("Proposal SHA-256", evidence.file_sha256)}
        ${proofRow("Anchor hash", evidence.anchor_hash)}
      </div>
    </article>

    <article class="card detail-section">
      <h2><span>02</span>BEACN's verdict</h2>
      <div class="callout">${esc(statement)}</div>
      ${state.statements.get(id)?.model ? `<p class="timestamp" style="margin-top:10px">Plain-language layer: ${esc(state.statements.get(id).model)}. The deterministic record below is binding.</p>` : ""}
    </article>

    ${renderAssessmentTree(assessment)}

    <article class="card detail-section">
      <h2><span>${assessment?.sections?.length ? "04" : "03"}</span>Reasons that structured the vote</h2>
      <p class="verify-copy">${esc(rationale.summary || "No deterministic summary was published.")}</p>
      <div class="metric-grid">
        <div class="metric"><span>Reason</span><strong title="${attr(reasonCode)}">${esc(reasonCode)}</strong></div>
        <div class="metric"><span>Score</span><strong>${esc(score)}</strong></div>
        <div class="metric"><span>Confidence</span><strong>${esc(confidenceText)}</strong></div>
      </div>
      ${Object.keys(scoring).length ? `<div class="proof-list">${Object.entries(scoring).map(([key, value]) => proofRow(key.replaceAll("_", " "), value)).join("")}</div>` : ""}
      ${missing.length ? `<h3 style="margin-top:18px">Missing evidence</h3><ul class="fix-list">${missing.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
      <h3 style="margin-top:18px">What would change the vote</h3>
      <ul class="fix-list">${(rationale.top_fixes || []).map(item => `<li>${esc(item)}</li>`).join("") || "<li>No specific changes were published.</li>"}</ul>
    </article>

    <article class="card detail-section">
      <h2><span>${assessment?.sections?.length ? "05" : "04"}</span>Proof and reproducibility</h2>
      <p class="subtitle">These receipts bind the public inputs and rule versions to the published result.</p>
      <div class="proof-list">
        ${proofRow("Vote", decision.vote || proof.vote)}
        ${proofRow("Submitted", decision.submitted_at)}
        ${proofRow("Transaction", decision.transaction_hash, decision.transaction_hash ? cardanoscan.tx(decision.transaction_hash) : "")}
        ${proofRow("Input hash", proof.input_hash)}
        ${proofRow("Snapshot bundle", proof.snapshot_bundle_hash)}
        ${proofRow("Soul commit", proof.soul_commit || reproducibility.soul_commit, repoCommit("beacn-drep-soul", proof.soul_commit || reproducibility.soul_commit))}
        ${proofRow("Resources commit", proof.resources_commit || reproducibility.resources_commit, repoCommit("beacn-drep-resources", proof.resources_commit || reproducibility.resources_commit))}
        ${proofRow("Core commit", proof.core_commit || reproducibility.core_commit, repoCommit("beacn-drep-core", proof.core_commit || reproducibility.core_commit))}
        ${proofRow("Rationale anchor", proof.rationale_anchor_hash, proof.rationale_anchor_url)}
      </div>
      <div class="detail-links">
        ${rationaleMarkdown ? `<a href="${attr(rationaleMarkdown)}" target="_blank" rel="noopener">Full rationale markdown ↗</a>` : ""}
        ${proof.rationale_anchor_url ? `<a href="${attr(proof.rationale_anchor_url)}" target="_blank" rel="noopener">Published anchor ↗</a>` : ""}
      </div>
    </article>
  </section>`;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [view = "home", encodedId] = raw.split("/");
  if (view === "action" && encodedId) return { view, id: decodeURIComponent(encodedId) };
  if (view === "decides" || view === "verify") return { view: "method" };
  return { view: ["home", "proposals", "method"].includes(view) ? view : "home" };
}

function updateNavigation(view) {
  document.querySelectorAll(".tab-bar a").forEach(link => link.classList.toggle("active", link.dataset.tab === view));
  if (view !== "action") document.body.classList.remove("detail-open");
}

async function renderRoute() {
  const route = parseRoute();
  if (["home", "proposals"].includes(route.view) && route.view !== activeListView) {
    state.verdict = "ALL";
    state.query = "";
    activeListView = route.view;
  }
  updateNavigation(route.view);
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    await loadFeeds();
    if (route.view === "home") renderHome();
    if (route.view === "proposals") renderProposals();
    if (route.view === "method") renderMethod();
    if (route.view === "action") await renderDetail(route.id);
    app.focus({ preventScroll: true });
  } catch (error) {
    app.innerHTML = `<div class="card empty"><h2>Could not load the public feeds</h2><p>${esc(error.message)}</p><button class="button" id="retry-load" type="button">Try again</button></div>`;
    document.getElementById("retry-load")?.addEventListener("click", async () => {
      state.status = null;
      await renderRoute();
    });
  }
}

function updateEpochClock() {
  const number = document.getElementById("epoch-number");
  if (!number) return;
  const elapsed = Math.max(0, Date.now() - CARDANO_START);
  const epoch = Math.floor(elapsed / EPOCH_MS);
  const within = elapsed % EPOCH_MS;
  const remaining = Math.max(0, Math.floor((EPOCH_MS - within) / 1000));
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  number.textContent = epoch;
  document.getElementById("epoch-countdown").textContent = `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  document.getElementById("epoch-progress").style.width = `${within / EPOCH_MS * 100}%`;
}

refreshButton.addEventListener("click", async () => {
  await loadFeeds(true);
  await renderRoute();
  showToast("Public feeds refreshed");
});
window.addEventListener("touchstart", event => {
  if (window.scrollY === 0 && event.touches.length === 1) {
    pullStart = event.touches[0].clientY;
    pullDistance = 0;
  }
}, { passive: true });
window.addEventListener("touchmove", event => {
  if (!pullStart || window.scrollY !== 0 || event.touches.length !== 1) return;
  pullDistance = Math.max(0, Math.min(110, event.touches[0].clientY - pullStart));
  if (!state.loading) refreshProgress.style.width = `${pullDistance / 110 * 100}%`;
}, { passive: true });
window.addEventListener("touchend", async () => {
  const shouldRefresh = pullDistance >= 80 && !state.loading;
  pullStart = 0;
  pullDistance = 0;
  if (shouldRefresh) {
    await loadFeeds(true);
    await renderRoute();
    showToast("Public feeds refreshed");
  } else if (!state.loading) {
    refreshProgress.style.width = "0";
  }
}, { passive: true });
window.addEventListener("hashchange", renderRoute);
window.addEventListener("online", () => { connectionDot.className = "connection-dot online"; });
window.addEventListener("offline", () => { connectionDot.className = "connection-dot offline"; });
setInterval(updateEpochClock, 1000);
setInterval(() => loadFeeds(true).then(renderRoute).catch(() => {}), 180000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.assessment.js").catch(() => {}));
}
if (!location.hash) history.replaceState(null, "", "#/home");
renderRoute();
