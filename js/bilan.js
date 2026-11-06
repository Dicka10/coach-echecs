// Bilan sur les N dernières parties : réutilise le cache et analyse le reste progressivement.
import { DEFAULT_PROVIDER, PROVIDERS } from './ai.js';
import { analyzer, isComplete } from './analyzer.js';
import { listGames, loadOlder } from './chesscom.js';
import { coachReady, keepVerifiedSentences } from './coach.js';
import * as db from './db.js';
import { copyText } from './export.js';
import { figurine } from './notation.js';
import { loadBook } from './openings.js';
import { aggregate, computeGameStats, PHASE_LABELS, STATS_VERSION } from './stats.js';
import { CLASSES, coachBox, esc, fmtPct } from './ui.js';

const SIZES = [10, 20, 30, 50, 100];
const FILTERS = [['all', 'Toutes'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapide']];
const MIN_GAMES_FOR_COACH = 5;

const batch = { running: false, total: 0, done: 0, error: null, stop: false };
const batchListeners = new Set();
const notifyBatch = () => batchListeners.forEach((fn) => fn());

async function runBatch(games, depth) {
  if (batch.running) return;
  Object.assign(batch, { running: true, total: games.length, done: 0, error: null, stop: false });
  await db.kvSet('bilanActive', true);
  notifyBatch();
  for (const game of games) {
    if (batch.stop) break;
    const existing = await db.get('analyses', game.uuid);
    await analyzer.start(game, { depth: existing?.depth ?? depth });
    await analyzer.running;
    if (analyzer.job?.error) {
      batch.error = analyzer.job.error;
      break;
    }
    // Si l'utilisateur a ouvert une autre partie, l'analyse a été interrompue : on s'arrête ici.
    if (!isComplete(await db.get('analyses', game.uuid))) break;
    batch.done += 1;
    notifyBatch();
  }
  const finished = batch.done === batch.total;
  batch.running = false;
  if (finished || batch.stop) await db.kvSet('bilanActive', false);
  notifyBatch();
}

async function ensureGames(username, filter, size) {
  const matching = (games) => (filter === 'all' ? games : games.filter((g) => g.time_class === filter));
  let games = matching(await listGames(username));
  let more = true;
  while (games.length < size && more) {
    more = (await loadOlder(username)).hasMore;
    games = matching(await listGames(username));
  }
  return games.slice(0, size);
}

async function loadStats(games, book, onProgress) {
  const items = [];
  const missing = [];
  for (const [index, game] of games.entries()) {
    const doc = await db.get('analyses', game.uuid);
    if (!isComplete(doc)) {
      missing.push(game);
      continue;
    }
    if (doc.stats?.version !== STATS_VERSION) {
      doc.stats = computeGameStats(game, doc, book);
      await db.put('analyses', doc);
      onProgress?.(index + 1, games.length);
      await new Promise((resolve) => { setTimeout(resolve); }); // laisse respirer l'interface
    }
    items.push({ game, stats: doc.stats });
  }
  return { items, missing };
}

const pct = (value, digits = 0) => (value === null ? '–' : fmtPct(value * 100, digits));
const fixed = (value, digits = 1) => (value === null ? '–' : value.toFixed(digits).replace('.', ','));

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) % 4294967291;
  return h.toString(36);
}

function aiData(summary, items) {
  const phaseData = Object.fromEntries(Object.entries(summary.phases).map(([key, p]) => [PHASE_LABELS[key], {
    coups: p.moves,
    erreurs: p.errors,
    gaffes: p.blunders,
    precision_moyenne: p.moves ? Math.round(p.accuracySum / p.moves) : null,
    erreurs_pour_100_coups: p.moves ? Math.round((p.errors / p.moves) * 100) : null,
  }]));
  return {
    parties: summary.games,
    victoires: summary.wins,
    nulles: summary.draws,
    defaites: summary.losses,
    // Le joueur a un Elo différent par cadence. Les parties sont triées de la plus récente à la plus ancienne.
    elo_par_cadence: Object.fromEntries([...items].reverse().map((i) => [i.game.time_class, i.game.myRating])),
    precision_moyenne: Math.round(summary.accuracy ?? 0),
    erreurs_par_partie: Number(fixed(summary.errorsPerGame).replace(',', '.')),
    gaffes_par_partie: Number(fixed(summary.blundersPerGame).replace(',', '.')),
    premiere_erreur_coup_moyen: Math.round(summary.firstErrorAverage ?? 0),
    phases: phaseData,
    types_erreurs: summary.kindList.map((k) => ({ type: k.label, nombre: k.count })),
    positions_gagnantes: summary.wasWinning,
    positions_gagnantes_transformees: summary.wonFromWinning,
    temps: {
      coups_en_manque_de_temps: summary.time.pressureMoves,
      taux_erreur_manque_de_temps: summary.pressureErrorRate,
      taux_erreur_temps_normal: summary.calmErrorRate,
      erreurs_jouees_en_3_secondes_ou_moins: summary.time.fastErrors,
    },
    ouvertures: summary.openingList.slice(0, 8).map((o) => ({
      nom: o.title,
      parties: o.games,
      victoires: o.wins,
      defaites: o.losses,
      precision_moyenne: Math.round(o.accuracySum / o.games),
    })),
  };
}

const AI_SCHEMA = {
  type: 'object',
  properties: {
    constat: { type: 'string', description: 'Le constat général en deux ou trois phrases.' },
    priorites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titre: { type: 'string' },
          pourquoi: { type: 'string', description: 'Le chiffre du bilan qui justifie cette priorité.' },
          entrainement: { type: 'string', description: 'Ce qu\'il faut travailler concrètement cette semaine.' },
        },
        required: ['titre', 'pourquoi', 'entrainement'],
      },
    },
    ouvertures: { type: 'string', description: 'Conseil sur le répertoire d\'ouvertures.' },
  },
  required: ['constat', 'priorites', 'ouvertures'],
};

const AI_SYSTEM = `Tu es un coach d'échecs exigeant et bienveillant. Tu écris en français et tu tutoies le joueur.
Tu reçois uniquement les statistiques agrégées de ses parties, calculées par Stockfish.

Règles obligatoires :
- Ne cite aucun coup précis et n'en calcule aucun.
- Appuie chaque affirmation sur un chiffre reçu et n'invente aucun chiffre.
- Si l'échantillon est faible pour conclure, dis-le.
- Propose exactement trois priorités, de la plus rentable à la moins rentable pour progresser à son Elo.
- Chaque entraînement doit être concret et faisable en une semaine, avec une durée et une méthode.
- Sois concis, donne ta réponse une seule fois et ne te répète pas.
- Dans les textes, les seuls échappements permis sont \\\\, \\n et \\". Écris les accents directement en UTF-8.`;

function claudeText(summary, items, filterLabel, username) {
  const lines = [
    `# Bilan Chess.com de ${username}`,
    `Elo par cadence : ${Object.entries(Object.fromEntries([...items].reverse().map((i) => [i.game.time_class, i.game.myRating]))).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Parties : ${summary.games} (${filterLabel}) · Victoires ${summary.wins}, nulles ${summary.draws}, défaites ${summary.losses}`,
    `Précision moyenne : ${fixed(summary.accuracy)} % (méthode Lichess, Stockfish 19 lite)`,
    `Erreurs par partie : ${fixed(summary.errorsPerGame)} · Gaffes par partie : ${fixed(summary.blundersPerGame)} · Première erreur en moyenne au coup ${fixed(summary.firstErrorAverage)}`,
    `Positions gagnantes (80 % de chances ou plus) : ${summary.wasWinning}, dont ${summary.wonFromWinning} gagnées`,
    `Erreurs en manque de temps : ${pct(summary.pressureErrorRate, 1)} des coups, contre ${pct(summary.calmErrorRate, 1)} sinon · Erreurs jouées en 3 s ou moins : ${summary.time.fastErrors}`,
    '',
    '## Phases',
    ...Object.entries(summary.phases).map(([k, p]) => `${PHASE_LABELS[k]} : ${p.moves} coups, ${p.errors} erreurs dont ${p.blunders} gaffes, précision moyenne ${p.moves ? Math.round(p.accuracySum / p.moves) : '?'} %`),
    '',
    '## Types d\'erreurs',
    ...summary.kindList.map((k) => `${k.label} : ${k.count}`),
    '',
    '## Ouvertures',
    ...summary.openingList.slice(0, 10).map((o) => `${o.title} : ${o.games} parties, ${o.wins} V, ${o.losses} D, précision ${Math.round(o.accuracySum / o.games)} %`),
    '',
    '## Plus grosses erreurs',
    ...summary.worst.map((w) => `${w.number.replace('…', '...')} ${w.san} contre ${w.opponent} [${CLASSES[w.cls].label}] chances ${w.before} → ${w.after} %. Meilleur : ${w.best.join(' ') || '?'}. FEN : ${w.fen}`),
    '',
    '## Parties',
    ...items.map(({ game, stats }) => `${new Date(game.end_time * 1000).toISOString().slice(0, 10)} ${game.color === 'w' ? 'Blancs' : 'Noirs'} contre ${game.opponent} (${game.oppRating}) : ${{ win: 'V', loss: 'D', draw: 'N' }[game.result]}, ${stats.openingTitle}, précision ${fixed(stats.accuracy)} % ${game.url}`),
  ];
  return lines.join('\n');
}

export async function showBilan(root, settings) {
  let size = await db.kvGet('bilanSize', 20);
  let filter = await db.kvGet('bilanFilter', settings.filter ?? 'all');
  let games = [];
  let missing = [];
  let items = [];
  let summary = null;
  let advice = null;
  let adviceKey = '';
  let adviceState = { loading: false, error: null };
  let alive = true;
  const book = await loadBook();

  root.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Retour à la liste">←</a>
      <div class="topbar-title"><strong>Mon bilan</strong><small>${esc(settings.username)}</small></div>
    </header>
    <main class="bilan">
      <div class="chips" id="filters">
        ${FILTERS.map(([k, l]) => `<button class="chip${filter === k ? ' active' : ''}" data-filter="${k}">${l}</button>`).join('')}
      </div>
      <label class="field">Nombre de parties
        <select id="size">${SIZES.map((n) => `<option value="${n}"${n === size ? ' selected' : ''}>${n} dernières parties</option>`).join('')}</select>
      </label>
      <section class="panel" id="progress"></section>
      <div id="content"></div>
    </main>`;

  const $ = (id) => root.querySelector(`#${id}`);

  function renderProgress() {
    const panel = $('progress');
    if (!panel) return;
    if (batch.running) {
      const job = analyzer.job;
      const part = job?.total ? job.done / job.total : 0;
      const total = batch.total || 1;
      const percent = Math.round(((batch.done + part) / total) * 100);
      panel.innerHTML = `
        <div class="progress-label"><span>Analyse : ${batch.done} sur ${batch.total} parties</span><span class="muted">${percent} %</span></div>
        <div class="progress"><div style="width:${percent}%"></div></div>
        <p class="muted small">Garde l'appli ouverte. Tu peux t'arrêter : ce qui est fait reste enregistré.</p>
        <button class="secondary" id="stopBatch">Mettre en pause</button>`;
      $('stopBatch').addEventListener('click', async () => {
        batch.stop = true;
        await analyzer.stop();
      });
      return;
    }
    if (missing.length === 0) {
      panel.innerHTML = `<p class="muted">${items.length} partie${items.length > 1 ? 's' : ''} analysée${items.length > 1 ? 's' : ''}, tout est à jour.</p>`;
      return;
    }
    panel.innerHTML = `
      ${batch.error ? `<p class="error">${esc(batch.error)}</p>` : ''}
      <p>${items.length} partie${items.length > 1 ? 's' : ''} déjà analysée${items.length > 1 ? 's' : ''}, ${missing.length} à analyser.</p>
      <button class="primary" id="startBatch">Analyser les parties manquantes</button>`;
    $('startBatch').addEventListener('click', () => startBatch());
  }

  function startBatch() {
    analyzer.job = analyzer.job?.error ? null : analyzer.job;
    runBatch(missing, settings.depth);
  }

  function renderContent() {
    const content = $('content');
    if (!content) return;
    if (!summary || items.length === 0) {
      content.innerHTML = '<p class="empty">Aucune partie analysée pour ce choix.</p>';
      return;
    }
    const s = summary;
    const phaseRows = Object.entries(s.phases).map(([key, p]) => `
      <tr><th scope="row">${PHASE_LABELS[key]}</th>
      <td>${p.moves ? Math.round(p.accuracySum / p.moves) : '–'}</td>
      <td>${p.errors}</td><td>${p.blunders}</td>
      <td>${p.moves ? fixed((p.errors / p.moves) * 100) : '–'}</td></tr>`).join('');
    const kinds = s.kindList.map((k) => `<div class="stat-row"><span>${esc(k.label)}</span><strong>${k.count}</strong></div>`).join('');
    const openings = s.openingList.slice(0, 6).map((o) => `
      <tr><th scope="row">${esc(o.title)}</th><td>${o.games}</td><td>${o.wins}-${o.losses}</td><td>${Math.round(o.accuracySum / o.games)}</td></tr>`).join('');
    const worst = s.worst.slice(0, 5).map((w) => `
      <a class="worst" href="#/partie/${esc(w.uuid)}/${w.ply - 1}">
        <span class="tag cls-${w.cls}">${CLASSES[w.cls].symbol}</span>
        <span><strong>${esc(w.number)} ${figurine(esc(w.san))}</strong> contre ${esc(w.opponent)}<br><small class="muted">${esc(w.note)} ${w.before} → ${w.after} %</small></span>
      </a>`).join('');

    content.innerHTML = `
      <div class="tiles">
        <div><span class="muted">Parties</span><strong>${s.wins}-${s.draws}-${s.losses}</strong><small class="muted">V-N-D</small></div>
        <div><span class="muted">Précision</span><strong>${pct(s.accuracy === null ? null : s.accuracy / 100, 1)}</strong><small class="muted">moyenne</small></div>
        <div><span class="muted">Gaffes</span><strong>${fixed(s.blundersPerGame)}</strong><small class="muted">par partie</small></div>
        <div><span class="muted">1re erreur</span><strong>${fixed(s.firstErrorAverage, 0)}</strong><small class="muted">coup moyen</small></div>
      </div>
      <section class="panel" id="advice"></section>
      <section class="panel"><h2>Tes erreurs à revoir</h2><p class="muted small">Touche une erreur : la position s'ouvre juste avant ta faute. Cherche le meilleur coup, puis avance d'un coup pour vérifier.</p>${worst || '<p class="muted">Aucune erreur grave.</p>'}</section>
      <section class="panel"><h2>Phases de jeu</h2>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Précision</th><th>Erreurs</th><th>Gaffes</th><th>Pour 100 coups</th></tr></thead>
          <tbody>${phaseRows}</tbody>
        </table></div>
      </section>
      <section class="panel"><h2>Types d'erreurs</h2>${kinds || '<p class="muted">Aucune.</p>'}</section>
      <section class="panel"><h2>Gestion du temps</h2>
        <div class="stat-row"><span>Erreurs quand il reste peu de temps</span><strong>${pct(s.pressureErrorRate, 1)}</strong></div>
        <div class="stat-row"><span>Erreurs le reste du temps</span><strong>${pct(s.calmErrorRate, 1)}</strong></div>
        <div class="stat-row"><span>Erreurs jouées en 3 s ou moins</span><strong>${s.time.fastErrors}</strong></div>
        <p class="muted small">Peu de temps : 10 % du temps de départ ou moins, avec un minimum de 10 s.</p>
      </section>
      <section class="panel"><h2>Avantage</h2>
        <div class="stat-row"><span>Parties avec une position gagnante</span><strong>${s.wasWinning}</strong></div>
        <div class="stat-row"><span>Dont gagnées</span><strong>${s.wonFromWinning}</strong></div>
        <p class="muted small">Gagnante : 80 % de chances ou plus à un moment de la partie.</p>
      </section>
      <section class="panel"><h2>Ouvertures</h2>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Parties</th><th>V-D</th><th>Précision</th></tr></thead>
          <tbody>${openings}</tbody>
        </table></div>
      </section>
      <button class="secondary" id="copyBilan">Copier pour Claude</button>`;
    $('copyBilan').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const label = FILTERS.find(([k]) => k === filter)?.[1] ?? filter;
      const done = await copyText(claudeText(s, items, label, settings.username));
      button.textContent = done ? 'Copié !' : 'Copie impossible';
      setTimeout(() => { if (button.isConnected) button.textContent = 'Copier pour Claude'; }, 2000);
    });
    renderAdvice();
  }

  function renderAdvice() {
    const panel = $('advice');
    if (!panel) return;
    let body;
    if (advice) {
      const priorities = (advice.priorites ?? []).map((p, i) => `
        <div class="priority"><strong>${i + 1}. ${esc(p.titre)}</strong><p class="muted">${esc(p.pourquoi)}</p><p>${esc(p.entrainement)}</p></div>`).join('');
      body = `${coachBox(`<p>${esc(advice.constat)}</p>`)}${priorities}${advice.ouvertures ? `<p><strong>Ouvertures :</strong> ${esc(advice.ouvertures)}</p>` : ''}`;
    } else if (adviceState.loading) {
      body = '<p class="muted">Le coach étudie tes statistiques…</p>';
    } else if (items.length < MIN_GAMES_FOR_COACH) {
      body = `<p class="muted">Il faut au moins ${MIN_GAMES_FOR_COACH} parties analysées pour des conseils fiables.</p>`;
    } else if (!coachReady(settings)) {
      body = '<p class="muted">Ajoute ta clé dans les réglages pour obtenir ton plan.</p><a class="link" href="#/reglages">Ouvrir les réglages</a>';
    } else {
      body = `${adviceState.error ? `<p class="error">${esc(adviceState.error)}</p>` : ''}
        <button class="primary" id="askAdvice">${adviceState.error ? 'Réessayer' : 'Obtenir mon plan de progression'}</button>
        ${missing.length ? `<p class="muted small">Ce plan portera sur ${items.length} parties. Termine l'analyse pour en inclure ${missing.length} de plus.</p>` : ''}`;
    }
    panel.innerHTML = `<h2>Plan de progression</h2>${body}`;
    panel.querySelector('#askAdvice')?.addEventListener('click', askAdvice);
  }

  async function askAdvice() {
    adviceState = { loading: true, error: null };
    renderAdvice();
    try {
      const providerId = settings.aiProvider ?? DEFAULT_PROVIDER;
      const provider = PROVIDERS[providerId];
      const answer = await provider.generateJson({
        system: AI_SYSTEM,
        prompt: `Voici les statistiques du joueur, au format JSON :\n${JSON.stringify(aiData(summary, items))}`,
        schema: AI_SCHEMA,
        formatHint: 'Réponds uniquement en JSON avec "constat", "priorites" (liste de "titre", "pourquoi", "entrainement") et "ouvertures".',
      }, { key: settings.aiKeys[providerId], model: settings.aiModel ?? provider.models[0].id });
      const noMoves = new Set();
      advice = {
        constat: keepVerifiedSentences(answer.constat ?? '', noMoves),
        priorites: (answer.priorites ?? []).map((p) => ({
          titre: keepVerifiedSentences(p.titre ?? '', noMoves),
          pourquoi: keepVerifiedSentences(p.pourquoi ?? '', noMoves),
          entrainement: keepVerifiedSentences(p.entrainement ?? '', noMoves),
        })),
        ouvertures: keepVerifiedSentences(answer.ouvertures ?? '', noMoves),
      };
      await db.kvSet(adviceKey, advice);
      adviceState = { loading: false, error: null };
    } catch (err) {
      console.error(err);
      adviceState = { loading: false, error: err.message || 'Le coach n\'a pas pu répondre.' };
    }
    if (alive) renderAdvice();
  }

  async function reload() {
    $('progress').innerHTML = '<p class="muted">Chargement…</p>';
    let current;
    try {
      games = await ensureGames(settings.username, filter, size);
      current = await loadStats(games, book, (n, total) => {
        if (alive && $('progress')) $('progress').innerHTML = `<p class="muted">Calcul des statistiques : ${n} sur ${total}…</p>`;
      });
    } catch (err) {
      if (alive) $('progress').innerHTML = `<p class="error">${esc(err.message)}</p>`;
      return;
    }
    if (!alive) return;
    ({ items, missing } = current);
    summary = items.length ? aggregate(items) : null;
    adviceKey = `bilanCoach:${hash(items.map((i) => i.game.uuid).sort().join())}`;
    advice = await db.kvGet(adviceKey, null);
    renderProgress();
    renderContent();
  }

  $('filters').addEventListener('click', async (e) => {
    const value = e.target.dataset.filter;
    if (!value || batch.running) return;
    filter = value;
    await db.kvSet('bilanFilter', filter);
    root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
    reload();
  });
  $('size').addEventListener('change', async (e) => {
    if (batch.running) { e.target.value = size; return; }
    size = Number(e.target.value);
    await db.kvSet('bilanSize', size);
    reload();
  });

  let doneSeen = batch.done;
  const onBatch = () => {
    if (!alive) return;
    if (!batch.running || batch.done !== doneSeen) {
      doneSeen = batch.done;
      reload();
    } else {
      renderProgress();
    }
  };
  const onAnalyzer = () => { if (alive && batch.running) renderProgress(); };
  batchListeners.add(onBatch);
  analyzer.addEventListener('change', onAnalyzer);

  await reload();
  // Reprend seul un bilan interrompu par une fermeture de l'appli.
  if (!batch.running && missing.length && await db.kvGet('bilanActive', false)) startBatch();

  return () => {
    alive = false;
    batchListeners.delete(onBatch);
    analyzer.removeEventListener('change', onAnalyzer);
  };
}
