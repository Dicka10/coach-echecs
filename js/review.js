// Écran d'analyse d'une partie.
import { Chess } from '../vendor/chess.js';
import { analyzer, buildReview, isComplete, parseGame, summarize } from './analyzer.js';
import { createBoard } from './board.js';
import { renderChart } from './chart.js';
import { openingName } from './chesscom.js';
import * as db from './db.js';
import { winPercent } from './lichess.js';
import { bookInfo, describeOpening, loadBook, openingGenre } from './openings.js';
import { BAD_CLASSES, cadence, esc, CLASSES, fmtDate, fmtPct } from './ui.js';

const FIGURES = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
const figurine = (san) => san.replace(/[KQRBN]/g, (c) => `${FIGURES[c]}︎`);

export function pvToSan(fen, pv) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.split(' ').filter(Boolean)) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(move.san);
    } catch { break; }
  }
  return out;
}

function evalText(score, color) {
  if (!score) return '';
  if (score.over) return score.over === color ? 'Mat' : 'Maté';
  const sign = color === 'w' ? 1 : -1;
  if (score.mate !== undefined) return `${score.mate * sign > 0 ? '+' : '-'}M${Math.abs(score.mate)}`;
  const pawns = (score.cp * sign) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1).replace('.', ',')}`;
}

export async function showReview(root, game, settings, helpers) {
  const parsed = parseGame(game);
  const total = parsed.moves.length;
  const my = game.color;
  let doc = await db.get('analyses', game.uuid);
  let evals = doc?.evals ?? new Array(total + 1).fill(null);
  const book = await loadBook();
  const opening = bookInfo(parsed, book);
  const memo = new Map();
  const review = () => buildReview(parsed, evals, book, my, memo);
  let reviewed = review();
  let ply = 0;

  const resultWord = { win: 'Victoire', loss: 'Défaite', draw: 'Nulle' }[game.result];
  root.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Retour à la liste">←</a>
      <div class="topbar-title">
        <strong>Contre ${esc(game.opponent)}</strong>
        <small>${resultWord} · ${fmtDate(game.end_time)} · ${esc(cadence(game.time_class))}</small>
      </div>
    </header>
    <main class="review">
      <div class="board-col">
        <div class="status" id="status" hidden></div>
        <div class="board-row">
          <div class="evalbar" id="evalbar" aria-hidden="true"><div></div></div>
          <div id="board"></div>
        </div>
        <div class="nav">
          <button data-go="first" aria-label="Début">⏮</button>
          <button data-go="prev" aria-label="Coup précédent">◀</button>
          <button data-go="next" aria-label="Coup suivant">▶</button>
          <button data-go="last" aria-label="Fin">⏭</button>
        </div>
        <p class="keys muted small">Clavier : ← → pour les coups, ↑ début, ↓ fin</p>
      </div>
      <div class="side-col">
        <section class="panel" id="moveinfo" aria-live="polite"></section>
        <div class="error-nav">
          <button data-jump="-1">← Mon erreur précédente</button>
          <button data-jump="1">Mon erreur suivante →</button>
        </div>
        <section class="panel chart-panel"><h2>Mes chances de gain</h2><div id="chart"></div>
          <p class="muted small">Point plein : ton coup. Rond vide : coup adverse.</p></section>
        <section class="panel" id="summary"></section>
        <section class="panel"><h2>Coups</h2><div class="moves" id="moves"></div></section>
      </div>
    </main>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const board = createBoard($('board'), my);

  // Le nom le plus précis trouvé dans la base, sinon celui donné par Chess.com.
  function gameOpening() {
    const [eco, name] = opening.last?.split('|') ?? [];
    return { eco: eco ?? gameEco(game), name: name ?? openingName(game) };
  }

  function points() {
    const list = [];
    evals.forEach((e, i) => { if (e) list.push({ ply: i, pct: winPercent(e.s, my) }); });
    return list;
  }

  function myMistakes() {
    return reviewed.filter((r) => r && r.color === my && BAD_CLASSES.has(r.cls));
  }

  function renderPosition() {
    const move = ply > 0 ? parsed.moves[ply - 1] : null;
    const info = ply > 0 ? reviewed[ply - 1] : null;
    const isBad = info && BAD_CLASSES.has(info.cls);
    let arrow = null;
    if (isBad && info.best) arrow = { from: info.best.slice(0, 2), to: info.best.slice(2, 4) };
    board.render({
      fen: parsed.fens[ply],
      lastMove: move ? { from: move.from, to: move.to } : null,
      arrow,
      mark: info ? { cls: info.cls, symbol: CLASSES[info.cls].symbol } : null,
    });
    renderEvalBar();
    renderMoveInfo(move, info);
    renderCurve();
    root.querySelectorAll('.move').forEach((b) => {
      const active = Number(b.dataset.ply) === ply;
      b.classList.toggle('active', active);
      // Fait défiler la liste des coups seule, jamais toute la page.
      if (active) {
        const list = $('moves');
        const top = b.offsetTop - list.offsetTop;
        if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - b.offsetHeight) {
          list.scrollTop = top - list.clientHeight / 2;
        }
      }
    });
  }

  function renderEvalBar() {
    const e = evals[ply];
    const pct = e ? winPercent(e.s, my) : 50;
    $('evalbar').firstElementChild.style.height = `${pct}%`;
  }

  function renderMoveInfo(move, info) {
    const e = evals[ply];
    if (!move) {
      const { eco, name } = gameOpening();
      const described = describeOpening(name);
      const genre = openingGenre(parsed.moves);
      $('moveinfo').innerHTML = `
        <div class="move-head"><h2>${esc(described.title)}</h2><span class="muted">${esc(eco)}</span></div>
        ${described.variation ? `<p class="muted">${esc(described.variation)}</p>` : ''}
        <span class="genre">${esc(genre.label)}</span>
        <p>${esc(described.description || genre.hint)}</p>`;
      return;
    }
    const number = Math.ceil(ply / 2);
    const prefix = `${number}${move.color === 'w' ? '.' : '…'}`;
    const who = move.color === my ? 'Ton coup' : 'Coup adverse';
    if (!info) {
      $('moveinfo').innerHTML = `<h2>${prefix} ${figurine(esc(move.san))}</h2><p class="muted">${who} · en attente d'analyse</p>`;
      return;
    }
    const cls = CLASSES[info.cls];
    const beforePct = winPercent(evals[ply - 1].s, my);
    const afterPct = winPercent(e.s, my);
    let best = '';
    if (BAD_CLASSES.has(info.cls) && info.best) {
      const san = pvToSan(parsed.fens[ply - 1], info.pv || info.best);
      if (san.length) {
        best = `<p class="best">Meilleur coup : <strong>${figurine(esc(san[0]))}</strong></p>
          ${san.length > 1 ? `<p class="line">Suite : ${figurine(esc(san.join(' ')))}</p>` : ''}`;
      }
    }
    let note = info.note;
    if (info.cls === 'book') {
      const name = opening.names[ply]?.split('|')[1];
      if (name) {
        const described = describeOpening(name);
        note = `Théorie : ${described.title}${described.variation ? `, ${described.variation}` : ''}.`;
      }
    }
    $('moveinfo').innerHTML = `
      <div class="move-head">
        <h2>${prefix} ${figurine(esc(move.san))}</h2>
        <span class="tag cls-${info.cls}">${cls.symbol} ${cls.label}</span>
      </div>
      <p class="note">${esc(note)}</p>
      <p class="muted">${who} · Mes chances : ${fmtPct(beforePct)} → ${fmtPct(afterPct)} · Éval. ${evalText(e.s, my)}</p>
      ${best}`;
  }

  function renderCurve() {
    renderChart($('chart'), {
      points: points(),
      marks: reviewed.filter(Boolean).map((r) => ({
        ply: r.ply, cls: r.cls, mine: r.color === my, pct: winPercent(evals[r.ply].s, my),
      })),
      current: ply,
      total,
      onSelect: (p) => goTo(p),
    });
  }

  function renderSummary() {
    const { counts, accuracy } = summarize(reviewed, evals);
    const mine = counts[my];
    const opp = counts[my === 'w' ? 'b' : 'w'];
    const accMine = accuracy?.[my];
    const accOpp = accuracy?.[my === 'w' ? 'b' : 'w'];
    const rows = Object.keys(CLASSES).map((key) => `
      <div class="count-row">
        <span class="tag cls-${key}">${CLASSES[key].symbol} ${CLASSES[key].label}</span>
        <strong>${mine[key]}</strong><span class="muted">${opp[key]}</span>
      </div>`).join('');
    $('summary').innerHTML = `
      <div class="accuracy">
        <div><span class="muted">Ma précision</span><strong>${accMine == null ? '…' : fmtPct(accMine, 1)}</strong></div>
        <div><span class="muted">${esc(game.opponent)}</span><strong>${accOpp == null ? '…' : fmtPct(accOpp, 1)}</strong></div>
      </div>
      <div class="count-row count-head"><span></span><span>Moi</span><span>Adv.</span></div>
      ${rows}
      <p class="muted small">Précision : méthode Lichess · Catégories proches de Chess.com${doc ? ` · Profondeur ${doc.depth}` : ''}</p>
      ${isComplete(doc) && settings.depth > doc.depth
        ? `<button class="link" id="deeper">Réanalyser en profondeur ${settings.depth}</button>` : ''}`;
    root.querySelector('#deeper')?.addEventListener('click', async () => {
      await db.del('analyses', game.uuid);
      helpers.rerender();
      analyzer.start(game, { depth: settings.depth });
    });
  }

  function renderMoves() {
    const html = parsed.moves.map((m, i) => {
      const r = reviewed[i];
      const mine = m.color === my;
      const dot = r ? `<i class="dot cls-${r.cls}"></i>` : '';
      const num = m.color === 'w' ? `<span class="num">${(i / 2) + 1}.</span>` : '';
      return `${num}<button class="move${mine ? ' mine' : ''}" data-ply="${i + 1}">${dot}${figurine(esc(m.san))}</button>`;
    }).join('');
    $('moves').innerHTML = html;
  }

  function renderStatus() {
    const job = analyzer.job?.uuid === game.uuid ? analyzer.job : null;
    const status = $('status');
    if (isComplete(doc)) { status.hidden = true; return; }
    status.hidden = false;
    if (job?.error) {
      status.innerHTML = `<p>${esc(job.error)}</p><button class="primary" id="resume">Reprendre</button>`;
    } else if (job) {
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      const left = job.msPerPosition ? Math.ceil(((job.total - job.done) * job.msPerPosition) / 60000) : null;
      status.innerHTML = `
        <div class="progress-label"><span>Analyse en cours : ${pct} %</span>
        <span class="muted">${left ? `environ ${left} min` : ''}</span></div>
        <div class="progress"><div style="width:${pct}%"></div></div>`;
    } else {
      const saved = evals.filter(Boolean).length;
      status.innerHTML = `<button class="primary" id="resume">${saved ? `Reprendre l'analyse (${Math.round((saved / evals.length) * 100)} %)` : "Analyser cette partie"}</button>`;
    }
    root.querySelector('#resume')?.addEventListener('click', () => {
      analyzer.job = null;
      analyzer.start(game, { depth: doc?.depth ?? settings.depth });
    });
  }

  function goTo(target) {
    ply = Math.max(0, Math.min(total, target));
    renderPosition();
  }

  root.querySelector('.nav').addEventListener('click', (e) => {
    const go = e.target.closest('button')?.dataset.go;
    if (!go) return;
    goTo({ first: 0, prev: ply - 1, next: ply + 1, last: total }[go]);
  });
  root.querySelector('.error-nav').addEventListener('click', (e) => {
    const dir = Number(e.target.closest('button')?.dataset.jump);
    if (!dir) return;
    const list = myMistakes();
    const target = dir > 0 ? list.find((r) => r.ply > ply) : [...list].reverse().find((r) => r.ply < ply);
    if (target) goTo(target.ply);
  });
  $('moves').addEventListener('click', (e) => {
    const p = e.target.closest('.move')?.dataset.ply;
    if (p) goTo(Number(p));
  });

  async function refreshFromStore() {
    doc = await db.get('analyses', game.uuid);
    if (doc) evals = doc.evals;
    reviewed = review();
    renderStatus();
    renderSummary();
    renderMoves();
    renderPosition();
  }

  const onChange = () => { if (root.isConnected) refreshFromStore(); };
  analyzer.addEventListener('change', onChange);
  const onResize = () => renderCurve();
  window.addEventListener('resize', onResize);

  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches?.('input, textarea')) return;
    const target = { ArrowLeft: ply - 1, ArrowRight: ply + 1, ArrowUp: 0, ArrowDown: total }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    goTo(target);
  };
  document.addEventListener('keydown', onKey);

  renderStatus();
  renderSummary();
  renderMoves();
  renderPosition();

  // Lance ou reprend seule l'analyse manquante : une partie terminée n'est jamais recalculée.
  if (!isComplete(doc) && !analyzer.isRunning(game.uuid)) {
    analyzer.start(game, { depth: doc?.depth ?? settings.depth });
  }

  return () => {
    analyzer.removeEventListener('change', onChange);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
  };
}

function gameEco(game) {
  return /\[ECO "([^"]+)"\]/.exec(game.pgn)?.[1] ?? '';
}
