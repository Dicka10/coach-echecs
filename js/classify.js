// Classification façon Chess.com et phrase d'explication, sans IA.
//
// Seuils publics de Chess.com (points attendus perdus) :
//   0 Meilleur, jusqu'à 0,02 Excellent, 0,05 Bon, 0,10 Imprécision, 0,20 Erreur, au-delà Gaffe.
// Une gaffe doit aussi perdre du matériel ou la partie.
//
// Le modèle de chances de gain de Chess.com dépend de l'Elo et n'est pas publié :
// on utilise celui de Lichess. Les règles de Génial, Très bon et Occasion manquée ne sont
// pas chiffrées par Chess.com : les valeurs de RULES sont des choix propres à cette appli.
import { Chess } from '../vendor/chess.js';
import { winPercent } from './lichess.js';

export const RULES = {
  bookMaxLoss: 0.10,
  greatGap: 0.20, // chaque autre coup coûte au moins autant
  greatMinAfter: 0.40, // un seul bon coup qui perd quand même n'est pas un grand coup
  brilliantMinAfter: 0.45, // pas en mauvaise position après le sacrifice
  brilliantMaxAlt: 0.90, // pas déjà gagnant sans ce coup
  sacrificeMinNet: 2, // au moins deux points de matériel offerts
  missMinBefore: 0.70, // la position offerte était nettement gagnante
  missMaxAfter: 0.60,
  missMateLength: 5, // rater un mat en 5 ou moins
};

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const OWN = { p: 'un pion', n: 'ton cavalier', b: 'ton fou', r: 'ta tour', q: 'ta dame' };
const THEIR = { p: 'un pion', n: 'son cavalier', b: 'son fou', r: 'sa tour', q: 'sa dame' };
const GAIN = { p: "d'un pion", n: "d'un cavalier", b: "d'un fou", r: "d'une tour", q: 'de la dame' };
const SACRIFICE = { n: 'de cavalier', b: 'de fou', r: 'de tour', q: 'de dame' };
const PREVIOUS_BAD = new Set(['mistake', 'miss', 'blunder']);

const expected = (score, color) => winPercent(score, color) / 100;
const sideMate = (score, color) => (score.mate === undefined ? 0 : color === 'w' ? score.mate : -score.mate);

function balance(fen, color) {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (VALUE[lower] === undefined) continue;
    const owner = ch === lower ? 'b' : 'w';
    total += owner === color ? VALUE[lower] : -VALUE[lower];
  }
  return total;
}

// Suit la variante de Stockfish et mesure le matériel quand c'est de nouveau au joueur de jouer.
function followLine(startFen, pv, color, maxPlies = 6) {
  const chess = new Chess(startFen);
  const lost = [];
  const won = [];
  let result = { balance: balance(startFen, color), lost: [], won: [] };
  for (const uci of (pv || '').split(' ').filter(Boolean).slice(0, maxPlies)) {
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch { break; }
    if (move.captured) (move.color === color ? won : lost).push(move.captured);
    if (chess.turn() === color) result = { balance: balance(chess.fen(), color), lost: [...lost], won: [...won] };
  }
  return result;
}

const heaviest = (pieces) => [...pieces].sort((a, b) => VALUE[b] - VALUE[a])[0];

// Pièces (cavalier ou plus) que l'adversaire peut prendre avec un net gain de matériel.
function hangingSquares(fen, color) {
  const parts = fen.split(' ');
  parts[1] = color === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const hanging = new Map();
  let chess;
  try {
    chess = new Chess(parts.join(' '), { skipValidation: true });
    for (const move of chess.moves({ verbose: true })) {
      if (!move.captured || VALUE[move.captured] < 3) continue;
      const value = VALUE[move.captured];
      const defended = chess.attackers(move.to, color).length > 0;
      const net = defended ? value - VALUE[move.piece] : value;
      if (net >= RULES.sacrificeMinNet) hanging.set(move.to, move.captured);
    }
  } catch { /* position impossible à retourner, par exemple roi en échec */ }
  return hanging;
}

function findSacrifice({ prevFen, afterFen, move }) {
  const color = move.color;
  if (new Chess(afterFen).isCheckmate()) return null;
  const before = new Chess(prevFen).inCheck() ? new Map() : hangingSquares(prevFen, color);
  const after = hangingSquares(afterFen, color);
  const offered = [];
  for (const [square, piece] of after) {
    const moved = square === move.to;
    if (moved && move.captured && VALUE[move.captured] >= VALUE[piece] - 1) continue;
    if (!moved && before.has(square)) continue;
    if (moved && before.has(move.from)) continue; // la pièce était déjà en prise avant de bouger
    offered.push(piece);
  }
  return heaviest(offered) ?? null;
}

function explainBad(ctx, facts) {
  const { mine, move, prev, cur, previous } = ctx;
  const color = move.color;
  const subject = mine ? 'Tu' : "L'adversaire";
  const verb = (second, third) => (mine ? second : third);
  const allowed = sideMate(cur.s, color);
  if (cur.s.over && cur.s.over !== color) return ['mate_allowed', `${subject} ${verb('te fais', 'se fait')} mater.`];
  if (allowed < 0) return ['mate_allowed', `${subject} ${verb('laisses', 'laisse')} un mat en ${-allowed}.`];
  const hadMate = sideMate(prev.s, color);
  if (hadMate > 0 && allowed <= 0) return ['missed_mate', `${subject} ${verb('rates', 'rate')} un mat en ${hadMate}.`];

  const { netLoss, gain, played, best } = facts;
  if (netLoss >= 3) {
    const piece = heaviest(played.lost.filter((p) => VALUE[p] >= 3 && VALUE[p] <= netLoss + 1));
    const names = mine ? OWN : THEIR;
    return ['piece', piece ? `Ce coup perd ${names[piece]}.` : 'Ce coup perd du matériel.'];
  }
  if (netLoss === 2) return ['exchange', 'Ce coup perd la qualité : une tour contre une pièce plus faible.'];
  if (netLoss === 1) return ['pawn', 'Ce coup perd un pion.'];
  if (gain >= 1) {
    const piece = heaviest(best.won) ?? 'p';
    return ['missed_gain', `${subject} ${verb('rates', 'rate')} le gain ${GAIN[piece]}.`];
  }
  if (previous && PREVIOUS_BAD.has(previous.cls)) {
    return ['no_punish', mine ? "Tu ne profites pas de l'erreur adverse." : "L'adversaire ne profite pas de ton erreur."];
  }
  const beforePct = expected(prev.s, color);
  const afterPct = expected(cur.s, color);
  if (beforePct >= 0.4 && afterPct < 0.4) {
    return ['positional', mine ? "Pas de perte de matériel, mais l'adversaire prend l'avantage." : 'Pas de perte de matériel, mais tu prends l\'avantage.'];
  }
  if (beforePct > 0.6 && afterPct <= 0.6) {
    return ['positional', mine ? 'Ton avantage disparaît, sans perte de matériel.' : "L'avantage adverse disparaît, sans perte de matériel."];
  }
  return ['positional', mine ? 'Ce coup affaiblit ta position, sans perte immédiate de matériel.' : "Ce coup affaiblit la position adverse, sans perte immédiate de matériel."];
}

const GOOD_NOTES = {
  best: 'Le premier choix de Stockfish.',
  excellent: 'Presque aussi fort que le meilleur coup.',
  good: 'Un coup correct, mais il y avait mieux.',
  book: 'Un coup de théorie.',
  great: 'Le seul bon coup : tous les autres coûtent bien plus cher.',
};

export function classifyMove(ctx) {
  const { move, uci, prev, cur, previous, prevMove, inBook } = ctx;
  const color = move.color;
  const beforePct = expected(prev.s, color);
  const afterPct = expected(cur.s, color);
  const loss = Math.max(0, beforePct - afterPct);
  const isBest = Boolean(prev.b) && uci === prev.b;

  const base = balance(ctx.prevFen, color);
  const played = followLine(ctx.afterFen, cur.p, color);
  const best = followLine(ctx.prevFen, prev.p, color);
  const facts = {
    played,
    best,
    netLoss: Math.max(0, base - played.balance),
    gain: Math.max(0, best.balance - Math.max(base, played.balance)),
  };

  const finish = (cls, extra) => ({ cls, note: extra ?? (move.san.endsWith('#') ? 'Échec et mat !' : GOOD_NOTES[cls]), loss });

  if (inBook && loss < RULES.bookMaxLoss) return finish('book');

  if (isBest) {
    const alt = prev.alt ? expected(prev.alt.s, color) : null;
    if (alt !== null) {
      if (afterPct >= RULES.brilliantMinAfter && alt < RULES.brilliantMaxAlt) {
        const piece = findSacrifice(ctx);
        if (piece) return finish('brilliant', `Sacrifice ${SACRIFICE[piece]}, et c'est le meilleur coup !`);
      }
      const recapture = prevMove?.captured && prevMove.to === move.to;
      const punishes = move.captured && previous && PREVIOUS_BAD.has(previous.cls);
      const mates = move.san.endsWith('#');
      if (beforePct - alt >= RULES.greatGap && afterPct >= RULES.greatMinAfter && !recapture && !punishes && !mates) {
        return finish('great');
      }
    }
    return finish('best');
  }

  let cls;
  if (loss <= 0.02) cls = 'excellent';
  else if (loss <= 0.05) cls = 'good';
  else if (loss <= 0.10) cls = 'inaccuracy';
  else if (loss <= 0.20) cls = 'mistake';
  else cls = 'blunder';

  const mateAllowed = sideMate(cur.s, color) < 0 || (cur.s.over && cur.s.over !== color);
  const losesMaterial = best.balance - played.balance >= 1 || facts.netLoss >= 1;
  if (cls === 'blunder' && !mateAllowed && !losesMaterial && afterPct >= 0.2) cls = 'mistake';

  const hadMate = sideMate(prev.s, color);
  const missedMate = hadMate > 0 && hadMate <= RULES.missMateLength && sideMate(cur.s, color) <= 0 && !cur.s.over;
  const missedChance = previous && PREVIOUS_BAD.has(previous.cls)
    && beforePct >= RULES.missMinBefore && afterPct < RULES.missMaxAfter && loss > 0.10;
  if ((missedMate || missedChance) && !mateAllowed && facts.netLoss < 3) cls = 'miss';

  if (['excellent', 'good'].includes(cls)) return finish(cls);
  const [kind, note] = explainBad(ctx, facts);
  return { ...finish(cls, note), kind };
}
