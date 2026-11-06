// Statistiques du bilan, calculées une fois par partie puis enregistrées avec l'analyse.
import { buildReview, parseGame } from './analyzer.js';
import { openingName } from './chesscom.js';
import { moveNumber, pvToSan } from './notation.js';
import { bookInfo, describeOpening } from './openings.js';

export const STATS_VERSION = 1;

const ERROR_CLASSES = new Set(['mistake', 'miss', 'blunder']);
const WINNING_PCT = 80; // au-delà, la position est considérée comme gagnante
const FAST_MOVE_SECONDS = 3;

export const KIND_LABELS = {
  mate_allowed: 'Mat laissé à l\'adversaire',
  missed_mate: 'Mat raté',
  piece: 'Pièce perdue',
  exchange: 'Qualité perdue',
  pawn: 'Pion perdu',
  missed_gain: 'Gain de matériel raté',
  no_punish: 'Erreur adverse non punie',
  positional: 'Position dégradée sans perte de matériel',
};

export const PHASE_LABELS = { opening: 'Ouverture', middlegame: 'Milieu de partie', endgame: 'Finale' };

// Inspiré du découpage de Lichess : la finale commence à 6 pièces (hors pions et rois) ou moins.
function phaseOf(fen, ply) {
  let pieces = 0;
  for (const ch of fen.split(' ')[0]) if ('qrbnQRBN'.includes(ch)) pieces += 1;
  if (pieces <= 6) return 'endgame';
  if (ply <= 20 && pieces > 10) return 'opening';
  return 'middlegame';
}

function parseClocks(pgn) {
  const clocks = [];
  for (const m of pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)) {
    clocks.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return clocks;
}

function parseTimeControl(value) {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(String(value ?? ''));
  return match ? { base: Number(match[1]), increment: Number(match[2] ?? 0) } : null;
}

const emptyPhase = () => ({ moves: 0, errors: 0, blunders: 0, accuracySum: 0 });

export function computeGameStats(game, doc, book) {
  const parsed = parseGame(game);
  const reviewed = buildReview(parsed, doc.evals, book, game.color);
  const mine = reviewed.filter((r) => r && r.color === game.color);
  const clocks = parseClocks(game.pgn);
  const control = parseTimeControl(game.time_control);
  const pressureLimit = control ? Math.max(10, control.base * 0.1) : null;

  const phases = { opening: emptyPhase(), middlegame: emptyPhase(), endgame: emptyPhase() };
  const kinds = {};
  const time = { pressureMoves: 0, pressureErrors: 0, calmMoves: 0, calmErrors: 0, fastErrors: 0 };
  let peak = 0;
  let firstError = null;

  for (const r of mine) {
    const fen = parsed.fens[r.ply - 1];
    const phase = phases[phaseOf(fen, r.ply)];
    const isError = ERROR_CLASSES.has(r.cls);
    phase.moves += 1;
    phase.accuracySum += r.accuracy;
    if (isError) {
      phase.errors += 1;
      if (r.cls === 'blunder') phase.blunders += 1;
      kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      firstError ??= Math.ceil(r.ply / 2);
    }
    peak = Math.max(peak, r.before);

    const clock = clocks[r.ply - 1];
    if (control && clock !== undefined) {
      if (clock <= pressureLimit) {
        time.pressureMoves += 1;
        if (isError) time.pressureErrors += 1;
      } else {
        time.calmMoves += 1;
        if (isError) time.calmErrors += 1;
      }
      const previous = r.ply >= 3 ? clocks[r.ply - 3] : control.base;
      const spent = previous === undefined ? null : previous + control.increment - clock;
      if (isError && spent !== null && spent <= FAST_MOVE_SECONDS) time.fastErrors += 1;
    }
  }

  const worst = mine.filter((r) => ERROR_CLASSES.has(r.cls))
    .sort((a, b) => (b.before - b.after) - (a.before - a.after))
    .slice(0, 3)
    .map((r) => ({
      ply: r.ply,
      number: moveNumber(r.ply),
      san: parsed.moves[r.ply - 1].san,
      cls: r.cls,
      kind: r.kind,
      note: r.note,
      before: Math.round(r.before),
      after: Math.round(r.after),
      best: pvToSan(parsed.fens[r.ply - 1], r.pv || r.best).slice(0, 5),
      fen: parsed.fens[r.ply - 1],
    }));

  const opening = bookInfo(parsed, book).last?.split('|')[1] ?? openingName(game);
  return {
    version: STATS_VERSION,
    accuracy: doc.summary?.accuracy?.[game.color] ?? null,
    moves: mine.length,
    openingTitle: describeOpening(opening).title,
    phases,
    kinds,
    time,
    wasWinning: peak >= WINNING_PCT,
    firstError,
    worst,
  };
}

const rate = (part, total) => (total > 0 ? part / total : null);

export function aggregate(items) {
  const result = {
    games: items.length,
    wins: 0,
    draws: 0,
    losses: 0,
    accuracySum: 0,
    accuracyCount: 0,
    moves: 0,
    errors: 0,
    blunders: 0,
    wonFromWinning: 0,
    wasWinning: 0,
    phases: { opening: emptyPhase(), middlegame: emptyPhase(), endgame: emptyPhase() },
    kinds: {},
    time: { pressureMoves: 0, pressureErrors: 0, calmMoves: 0, calmErrors: 0, fastErrors: 0 },
    colors: { w: { games: 0, wins: 0, accuracySum: 0 }, b: { games: 0, wins: 0, accuracySum: 0 } },
    openings: {},
    firstErrorSum: 0,
    firstErrorCount: 0,
    worst: [],
  };

  for (const { game, stats } of items) {
    result[{ win: 'wins', draw: 'draws', loss: 'losses' }[game.result]] += 1;
    if (stats.accuracy !== null) {
      result.accuracySum += stats.accuracy;
      result.accuracyCount += 1;
    }
    result.moves += stats.moves;
    for (const [key, phase] of Object.entries(stats.phases)) {
      const total = result.phases[key];
      total.moves += phase.moves;
      total.errors += phase.errors;
      total.blunders += phase.blunders;
      total.accuracySum += phase.accuracySum;
      result.errors += phase.errors;
      result.blunders += phase.blunders;
    }
    for (const [kind, count] of Object.entries(stats.kinds)) result.kinds[kind] = (result.kinds[kind] ?? 0) + count;
    for (const key of Object.keys(result.time)) result.time[key] += stats.time[key];
    if (stats.wasWinning) {
      result.wasWinning += 1;
      if (game.result === 'win') result.wonFromWinning += 1;
    }
    if (stats.firstError !== null) {
      result.firstErrorSum += stats.firstError;
      result.firstErrorCount += 1;
    }
    const color = result.colors[game.color];
    color.games += 1;
    if (game.result === 'win') color.wins += 1;
    color.accuracySum += stats.accuracy ?? 0;

    const opening = (result.openings[stats.openingTitle] ??= { title: stats.openingTitle, games: 0, wins: 0, losses: 0, accuracySum: 0 });
    opening.games += 1;
    if (game.result === 'win') opening.wins += 1;
    if (game.result === 'loss') opening.losses += 1;
    opening.accuracySum += stats.accuracy ?? 0;

    for (const w of stats.worst) result.worst.push({ ...w, uuid: game.uuid, opponent: game.opponent });
  }

  result.accuracy = rate(result.accuracySum, result.accuracyCount);
  result.errorsPerGame = rate(result.errors, result.games);
  result.blundersPerGame = rate(result.blunders, result.games);
  result.firstErrorAverage = rate(result.firstErrorSum, result.firstErrorCount);
  result.pressureErrorRate = rate(result.time.pressureErrors, result.time.pressureMoves);
  result.calmErrorRate = rate(result.time.calmErrors, result.time.calmMoves);
  result.kindList = Object.entries(result.kinds).map(([kind, count]) => ({ kind, label: KIND_LABELS[kind] ?? kind, count }))
    .sort((a, b) => b.count - a.count);
  result.openingList = Object.values(result.openings).sort((a, b) => b.games - a.games);
  result.worst.sort((a, b) => (b.before - b.after) - (a.before - a.after));
  result.worst = result.worst.slice(0, 10);
  return result;
}
