// Analyse d'une partie : une recherche par position, sauvegardée immédiatement.
import { Chess } from '../vendor/chess.js';
import * as db from './db.js';
import { classifyMove } from './classify.js';
import { Engine, EngineStalled } from './engine.js';
import { gameAccuracy, moveAccuracy, winPercent } from './lichess.js';
import { bookInfo, loadBook } from './openings.js';
import { CLASSES } from './ui.js';

const MOVE_TIME_LIMIT_MS = 10000;
const MAX_RETRIES = 3;
export const ENGINE_NAME = 'Stockfish 19 lite';
// Version 2 : ajoute l'évaluation du 2e meilleur coup quand le coup joué est le meilleur.
export const SCHEMA = 2;
export const isComplete = (doc) => doc?.status === 'done' && doc.schema === SCHEMA;

export function parseGame(game) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const start = moves[0]?.before ?? chess.fen();
  const fens = [start, ...moves.map((m) => m.after)];
  const ucis = moves.map((m) => m.from + m.to + (m.promotion ?? ''));
  return { moves, fens, ucis, start };
}

function finishedScore(fen) {
  const pos = new Chess(fen);
  if (pos.isCheckmate()) return { over: pos.turn() === 'w' ? 'b' : 'w' };
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return { cp: 0 };
  return null;
}

// Résume une analyse terminée ou partielle en se limitant aux positions évaluées.
export function buildReview(parsed, evals, book, myColor, memo = new Map()) {
  const reviewed = [];
  const opening = bookInfo(parsed, book);
  let previous = null;
  for (let i = 0; i < parsed.moves.length; i++) {
    const prev = evals[i];
    const cur = evals[i + 1];
    const move = parsed.moves[i];
    if (!prev || !cur) { reviewed.push(null); previous = null; continue; }
    const key = `${i}|${prev.alt === undefined ? 0 : 1}|${previous?.cls ?? ''}`;
    let record = memo.get(key);
    if (!record) {
      const { cls, note, kind } = classifyMove({
        prevFen: parsed.fens[i],
        afterFen: parsed.fens[i + 1],
        move,
        uci: parsed.ucis[i],
        prev,
        cur,
        previous,
        prevMove: parsed.moves[i - 1],
        inBook: opening.inBook[i + 1],
        mine: move.color === myColor,
      });
      record = {
        ply: i + 1,
        color: move.color,
        cls,
        note,
        kind,
        accuracy: moveAccuracy(prev.s, cur.s, move.color),
        before: winPercent(prev.s, move.color),
        after: winPercent(cur.s, move.color),
        best: prev.b,
        pv: prev.p,
      };
      memo.set(key, record);
    }
    reviewed.push(record);
    previous = record;
  }
  return reviewed;
}

export function summarize(reviewed, evals) {
  const empty = () => Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
  const counts = { w: empty(), b: empty() };
  for (const r of reviewed) if (r) counts[r.color][r.cls] += 1;
  const complete = evals.every(Boolean);
  const accuracy = complete ? gameAccuracy(evals.map((e) => e.s)) : null;
  return { counts, accuracy };
}

class Analyzer extends EventTarget {
  constructor() {
    super();
    this.engine = new Engine();
    this.engineReady = false;
    this.job = null;
    this.wakeLock = null;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.job) this.keepAwake();
    });
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  isRunning(uuid) {
    return this.job?.uuid === uuid && !this.job.error;
  }

  async keepAwake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* non disponible : l'analyse reprendra simplement au retour */ }
  }

  releaseAwake() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  async start(game, { depth }) {
    if (this.isRunning(game.uuid)) return;
    await this.stop();
    const job = { uuid: game.uuid, done: 0, total: 0, msPerPosition: null, error: null, cancelled: false };
    this.job = job;
    this.emit();
    await db.kvSet('activeAnalysis', game.uuid);
    this.keepAwake();
    this.running = this.run(game, job, depth)
      .catch((err) => {
        console.error(err);
        job.error = err.message || 'Erreur pendant l\'analyse';
      })
      .finally(() => {
        this.releaseAwake();
        if (this.job === job && !job.error) this.job = null;
        this.emit();
      });
    return this.running;
  }

  async stop() {
    if (!this.job) return;
    this.job.cancelled = true;
    this.engine.stopSearch();
    await this.running;
    this.job = null;
  }

  async ensureEngine() {
    if (this.engineReady) return;
    await this.engine.start();
    this.engineReady = true;
  }

  async searchWithRetry(position, turn, depth, searchmoves) {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.ensureEngine();
        return await this.engine.analyse(position, turn, { depth, movetime: MOVE_TIME_LIMIT_MS, searchmoves });
      } catch (err) {
        this.engineReady = false;
        this.engine.terminate();
        if (attempt >= MAX_RETRIES) {
          throw err instanceof EngineStalled
            ? new Error('Le moteur ne répond plus. Touche « Reprendre ».')
            : err;
        }
      }
    }
  }

  async run(game, job, requestedDepth) {
    const parsed = parseGame(game);
    const total = parsed.fens.length;
    let doc = await db.get('analyses', game.uuid);
    if (!doc) {
      doc = {
        uuid: game.uuid,
        depth: requestedDepth,
        engine: ENGINE_NAME,
        status: 'partial',
        evals: new Array(total).fill(null),
        summary: null,
      };
    }
    if (doc.schema !== SCHEMA) {
      // Une analyse plus ancienne garde ses évaluations : seules les recherches manquantes sont faites.
      doc.schema = SCHEMA;
      doc.status = 'partial';
    }
    const book = await loadBook();
    const opening = bookInfo(parsed, book);
    job.total = total;
    job.done = 0;
    this.emit();

    const prefix = `position fen ${parsed.start} moves`;
    for (let i = 0; i < total; i++) {
      if (job.cancelled) return;
      const fen = parsed.fens[i];
      const turn = fen.split(' ')[1];
      const position = i === 0 ? `position fen ${parsed.start}` : `${prefix} ${parsed.ucis.slice(0, i).join(' ')}`;
      let changed = false;

      if (!doc.evals[i]) {
        const over = finishedScore(fen);
        if (over) {
          doc.evals[i] = { s: over, b: null, p: '', d: 0 };
        } else {
          const started = performance.now();
          const result = await this.searchWithRetry(position, turn, doc.depth);
          if (job.cancelled) return;
          doc.evals[i] = result;
          const elapsed = performance.now() - started;
          job.msPerPosition = job.msPerPosition === null ? elapsed : job.msPerPosition * 0.8 + elapsed * 0.2;
        }
        changed = true;
      }

      // Le coup joué est le meilleur : sa valeur dépend de ce que valent les autres.
      const entry = doc.evals[i];
      const needsAlternative = i < total - 1 && entry.alt === undefined
        && entry.b === parsed.ucis[i] && !opening.inBook[i + 1];
      if (needsAlternative) {
        const others = new Chess(fen).moves({ verbose: true })
          .map((m) => m.from + m.to + (m.promotion ?? ''))
          .filter((uci) => uci !== entry.b);
        if (others.length === 0) {
          entry.alt = null;
        } else {
          const result = await this.searchWithRetry(position, turn, doc.depth, others);
          if (job.cancelled) return;
          entry.alt = { s: result.s };
        }
        changed = true;
      }

      job.done = i + 1;
      if (changed) {
        await db.put('analyses', doc);
        this.emit();
      }
    }

    doc.status = 'done';
    doc.summary = summarize(buildReview(parsed, doc.evals, book, game.color), doc.evals);
    doc.finishedAt = Date.now();
    await db.put('analyses', doc);
    await db.kvSet('activeAnalysis', null);
  }
}

export const analyzer = new Analyzer();
