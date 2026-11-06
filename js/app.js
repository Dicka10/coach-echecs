// Point d'entrée : écrans, réglages, mise à jour de la PWA.
import { analyzer, ENGINE_NAME } from './analyzer.js';
import { ChessComError, listGames, loadOlder, openingName, refresh } from './chesscom.js';
import * as db from './db.js';
import { describeOpening } from './openings.js';
import { showReview } from './review.js';
import { cadence, esc, fmtDate, fmtPct } from './ui.js';

const root = document.getElementById('app');
const FILTERS = [
  ['all', 'Toutes'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapide'],
];
const DEFAULT_DEPTH = 14;
const settings = { username: '', depth: DEFAULT_DEPTH, filter: 'all' };
let cleanup = null;
let hasMore = true;
let refreshedThisSession = false;

async function loadSettings() {
  settings.username = await db.kvGet('username', '');
  settings.depth = await db.kvGet('depth', DEFAULT_DEPTH);
  settings.filter = await db.kvGet('filter', 'all');
}

function setView(html = '') {
  cleanup?.();
  cleanup = null;
  root.innerHTML = html;
  window.scrollTo(0, 0);
}

function showOnboarding(message = '') {
  setView(`
    <main class="onboarding">
      <div class="logo" aria-hidden="true">♞</div>
      <h1>Coach échecs</h1>
      <p class="muted">L'analyse de tes parties Chess.com, gratuite et sur ton téléphone.</p>
      <form id="userform">
        <label for="username">Ton pseudo Chess.com</label>
        <input id="username" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(settings.username)}">
        <button class="primary" type="submit">Continuer</button>
        ${message ? `<p class="error">${esc(message)}</p>` : ''}
      </form>
    </main>`);
  root.querySelector('#userform').addEventListener('submit', async (e) => {
    e.preventDefault();
    settings.username = root.querySelector('#username').value.trim();
    if (!settings.username) return;
    e.target.querySelector('button').disabled = true;
    try {
      const result = await refresh(settings.username);
      hasMore = result.hasMore;
      refreshedThisSession = true;
      await db.kvSet('username', settings.username);
      location.hash = '#/';
      route();
    } catch (err) {
      settings.username = '';
      showOnboarding(err instanceof ChessComError ? err.message : 'Une erreur est survenue.');
    }
  });
}

function badgeFor(analysis, job) {
  if (job) {
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    return `<span class="game-badge running">${pct} %</span>`;
  }
  if (analysis?.status === 'done') return '<span class="game-badge done">Analysée</span>';
  if (analysis) {
    const pct = Math.round((analysis.evals.filter(Boolean).length / analysis.evals.length) * 100);
    return `<span class="game-badge">En pause ${pct} %</span>`;
  }
  return '';
}

async function showHome() {
  setView(`
    <header class="topbar">
      <div class="topbar-title"><strong>Mes parties</strong><small>${esc(settings.username)}</small></div>
      <button class="icon-btn" id="reload" aria-label="Actualiser">↻</button>
      <a class="icon-btn" href="#/reglages" aria-label="Réglages">⚙</a>
    </header>
    <main class="home">
      <div class="install" id="install" hidden></div>
      <div class="chips" role="group" aria-label="Filtrer par cadence">
        ${FILTERS.map(([k, l]) => `<button class="chip${settings.filter === k ? ' active' : ''}" data-filter="${k}">${l}</button>`).join('')}
      </div>
      <p class="error" id="error" hidden></p>
      <ul class="games" id="games"></ul>
      <button class="secondary" id="more" hidden>Charger des parties plus anciennes</button>
    </main>`);

  const $ = (id) => root.querySelector(`#${id}`);
  let token = 0;

  async function renderList() {
    const current = ++token;
    const [games, analyses] = await Promise.all([listGames(settings.username), db.getAll('analyses')]);
    if (current !== token || !$('games')) return;
    const byId = new Map(analyses.map((a) => [a.uuid, a]));
    const shown = settings.filter === 'all' ? games : games.filter((g) => g.time_class === settings.filter);
    const labels = { win: 'V', loss: 'D', draw: 'N' };
    $('games').innerHTML = shown.length ? shown.slice(0, 200).map((g) => {
      const a = byId.get(g.uuid);
      const job = analyzer.job?.uuid === g.uuid && !analyzer.job.error ? analyzer.job : null;
      const acc = a?.summary?.accuracy?.[g.color];
      return `<li><a class="game" href="#/partie/${esc(g.uuid)}">
        <span class="result ${g.result}" aria-label="${g.result}">${labels[g.result]}</span>
        <span class="game-main">
          <strong>${esc(g.opponent)} <small>${esc(g.oppRating)}</small></strong>
          <small class="muted">${esc(describeOpening(openingName(g)).title)}</small>
          <small class="muted">${esc(cadence(g.time_class))} · ${fmtDate(g.end_time)}</small>
        </span>
        <span class="game-side">${acc != null ? `<strong>${fmtPct(acc, 1)}</strong>` : ''}${badgeFor(a, job)}</span>
      </a></li>`;
    }).join('') : '<li class="empty">Aucune partie pour cette cadence.</li>';
    $('more').hidden = !hasMore;
  }

  async function sync() {
    $('reload').disabled = true;
    $('error').hidden = true;
    try {
      const result = await refresh(settings.username);
      hasMore = result.hasMore;
      refreshedThisSession = true;
    } catch (err) {
      if ($('error')) {
        $('error').textContent = err.message;
        $('error').hidden = false;
      }
    }
    if ($('reload')) $('reload').disabled = false;
    if ($('games')) renderList();
  }

  root.querySelector('.chips').addEventListener('click', async (e) => {
    const f = e.target.dataset.filter;
    if (!f) return;
    settings.filter = f;
    await db.kvSet('filter', f);
    root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === f));
    renderList();
  });
  $('reload').addEventListener('click', sync);
  $('more').addEventListener('click', async () => {
    $('more').disabled = true;
    try {
      const r = await loadOlder(settings.username);
      hasMore = r.hasMore;
    } catch (err) {
      $('error').textContent = err.message;
      $('error').hidden = false;
    }
    $('more').disabled = false;
    renderList();
  });

  const onChange = () => renderList();
  analyzer.addEventListener('change', onChange);
  cleanup = () => analyzer.removeEventListener('change', onChange);

  renderInstallHint($('install'));
  await renderList();
  if (!refreshedThisSession) sync();
}

async function showGame(uuid) {
  const game = await db.get('games', uuid);
  if (!game) { location.hash = '#/'; return; }
  setView();
  cleanup = await showReview(root, game, settings, { rerender: () => showGame(uuid) });
}

async function showSettings() {
  setView(`
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Retour à la liste">←</a>
      <div class="topbar-title"><strong>Réglages</strong></div>
    </header>
    <main class="settings">
      <section class="panel">
        <h2>Compte Chess.com</h2>
        <p>${esc(settings.username)}</p>
        <button class="secondary" id="change">Changer de pseudo</button>
      </section>
      <section class="panel">
        <h2>Profondeur d'analyse</h2>
        <label class="range"><input id="depth" type="range" min="10" max="18" step="1" value="${settings.depth}">
        <output id="depthValue">${settings.depth}</output></label>
        <p class="muted small">Plus la profondeur est élevée, plus l'analyse est précise et lente. Chaque position est limitée à 10 secondes. Les parties déjà analysées ne changent pas.</p>
      </section>
      <section class="panel">
        <h2>Données sur ce téléphone</h2>
        <p class="muted small" id="storage">Calcul…</p>
        <button class="secondary danger" id="wipe">Effacer les analyses</button>
      </section>
      <section class="panel">
        <h2>À propos</h2>
        <p class="muted small" id="about">${esc(ENGINE_NAME)}</p>
        <p class="muted small">Précision : méthode Lichess. Catégories : seuils publics de Chess.com, avec des règles propres à cette appli pour Génial, Très bon et Occasion manquée. Les résultats peuvent donc différer de Chess.com. Ouvertures : base libre de Lichess.</p>
        <p class="muted small"><a href="https://github.com/Dicka10/coach-echecs" rel="noopener">Logiciel libre</a> sous licence AGPL-3.0. <a href="https://github.com/official-stockfish/Stockfish" rel="noopener">Stockfish</a>, <a href="https://github.com/nmrugg/stockfish.js" rel="noopener">stockfish.js</a>, <a href="https://github.com/jhlywa/chess.js" rel="noopener">chess.js</a>.</p>
      </section>
    </main>`);
  const $ = (id) => root.querySelector(`#${id}`);
  $('depth').addEventListener('input', (e) => { $('depthValue').textContent = e.target.value; });
  $('depth').addEventListener('change', async (e) => {
    settings.depth = Number(e.target.value);
    await db.kvSet('depth', settings.depth);
  });
  $('change').addEventListener('click', () => showOnboarding());
  $('wipe').addEventListener('click', async () => {
    if (!confirm('Effacer toutes les analyses enregistrées sur ce téléphone ?')) return;
    await analyzer.stop();
    await db.clear('analyses');
    await db.kvSet('activeAnalysis', null);
    showStorage();
  });
  async function showStorage() {
    const analyses = await db.getAll('analyses');
    const done = analyses.filter((a) => a.status === 'done').length;
    const estimate = await navigator.storage?.estimate?.();
    const size = estimate?.usage ? ` · ${(estimate.usage / 1048576).toFixed(1).replace('.', ',')} Mo` : '';
    if ($('storage')) $('storage').textContent = `${done} partie${done > 1 ? 's' : ''} analysée${done > 1 ? 's' : ''}${size}`;
  }
  showStorage();
  const version = await swVersion();
  if (version && $('about')) $('about').textContent += ` · Version ${version}`;
}

async function route() {
  const hash = location.hash || '#/';
  if (!settings.username) { showOnboarding(); return; }
  const game = /^#\/partie\/(.+)$/.exec(hash);
  if (game) return showGame(decodeURIComponent(game[1]));
  if (hash === '#/reglages') return showSettings();
  return showHome();
}

// ---- Installation et mise à jour ----

let installEvent = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  const el = document.getElementById('install');
  if (el) renderInstallHint(el);
});

async function renderInstallHint(el) {
  if (standalone() || await db.kvGet('installDismissed', false)) return;
  if (installEvent) {
    el.innerHTML = '<p>Installe l\'appli sur ton écran d\'accueil.</p><button class="primary" id="doInstall">Installer</button><button class="link" id="noInstall">Plus tard</button>';
    el.hidden = false;
    el.querySelector('#doInstall').addEventListener('click', async () => {
      await installEvent.prompt();
      installEvent = null;
      el.hidden = true;
    });
  } else if (isIos()) {
    el.innerHTML = '<p>Pour l\'installer : ouvre ce site dans Safari, touche Partager, puis « Sur l\'écran d\'accueil ». Tes analyses seront mieux conservées.</p><button class="link" id="noInstall">Compris</button>';
    el.hidden = false;
  }
  el.querySelector('#noInstall')?.addEventListener('click', async () => {
    el.hidden = true;
    await db.kvSet('installDismissed', true);
  });
}

function swVersion() {
  return new Promise((resolve) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data);
    worker.postMessage({ type: 'VERSION' }, [channel.port2]);
    setTimeout(() => resolve(null), 1000);
  });
}

let reloadRequested = false;

function showUpdateBanner(worker) {
  const banner = document.getElementById('update');
  banner.hidden = false;
  banner.querySelector('button').onclick = () => {
    reloadRequested = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const reg =await navigator.serviceWorker.register('sw.js');
  const watch = (worker) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
    });
  };
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
  if (reg.installing) watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reg.update().catch(() => {});
  });
}

async function resumeInterrupted() {
  const uuid = await db.kvGet('activeAnalysis', null);
  if (!uuid) return;
  const [game, doc] = await Promise.all([db.get('games', uuid), db.get('analyses', uuid)]);
  if (game && doc?.status !== 'done') analyzer.start(game, { depth: doc?.depth ?? settings.depth });
}

window.addEventListener('hashchange', route);

(async function main() {
  await loadSettings();
  navigator.storage?.persist?.().catch(() => {});
  await route();
  resumeInterrupted();
  registerServiceWorker();
})();
