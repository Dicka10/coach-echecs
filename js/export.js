// Résumé compact à coller dans Claude : PGN, erreurs et évaluations Stockfish.
import { moveNumber, pvToSan } from './notation.js';
import { BAD_CLASSES, CLASSES } from './ui.js';

const RESULT = { win: 'Victoire', loss: 'Défaite', draw: 'Nulle' };

function score(evalEntry) {
  const s = evalEntry.s;
  if (s.over) return s.over === 'w' ? '1-0#' : '0-1#';
  if (s.mate !== undefined) return `${s.mate > 0 ? '+' : '-'}M${Math.abs(s.mate)}`;
  return `${s.cp > 0 ? '+' : ''}${(s.cp / 100).toFixed(2)}`;
}

function cleanPgn(game, parsed) {
  const header = (name) => new RegExp(`\\[${name} "([^"]*)"\\]`).exec(game.pgn)?.[1] ?? '?';
  const moves = parsed.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m.san}` : m.san)).join(' ');
  const result = header('Result');
  return ['Event', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl', 'ECO']
    .map((name) => `[${name} "${header(name)}"]`).join('\n') + `\n\n${moves} ${result}`;
}

export function buildClaudeSummary({ game, parsed, reviewed, evals, doc, accuracy, counts, opening, engine, username }) {
  const myColor = game.color;
  const oppColor = myColor === 'w' ? 'b' : 'w';
  const pct = (v) => (v == null ? '?' : v.toFixed(1));
  const countLine = (c) => Object.keys(CLASSES).filter((k) => c[k]).map((k) => `${CLASSES[k].label} ${c[k]}`).join(', ');

  const lines = [
    '# Partie Chess.com analysée par Stockfish',
    `Joueur étudié : ${username} (${myColor === 'w' ? 'Blancs' : 'Noirs'}, ${game.myRating} Elo)`,
    `Adversaire : ${game.opponent} (${game.oppRating} Elo)`,
    `Résultat : ${RESULT[game.result]} · Cadence : ${game.time_class} (${game.time_control})`,
    `Ouverture : ${opening}`,
    `Lien : ${game.url}`,
    `Moteur : ${engine}, profondeur ${doc.depth}. Évaluations du point de vue des Blancs.`,
    'Précision : méthode Lichess. Catégories : proches de Chess.com, seuils indicatifs.',
    `Précision : joueur ${pct(accuracy?.[myColor])} %, adversaire ${pct(accuracy?.[oppColor])} %`,
    `Coups du joueur : ${countLine(counts[myColor])}`,
    `Coups de l'adversaire : ${countLine(counts[oppColor])}`,
    '',
    '## Erreurs et moments clés (J = joueur, A = adversaire)',
  ];

  for (const r of reviewed) {
    if (!r || !(BAD_CLASSES.has(r.cls) || r.cls === 'brilliant' || r.cls === 'great')) continue;
    const before = evals[r.ply - 1];
    const after = evals[r.ply];
    const best = pvToSan(parsed.fens[r.ply - 1], r.pv || r.best);
    const reply = pvToSan(parsed.fens[r.ply], after.p);
    lines.push(`${r.color === myColor ? 'J' : 'A'} ${moveNumber(r.ply).replace('…', '...')} ${parsed.moves[r.ply - 1].san} [${CLASSES[r.cls].label}] ${score(before)} → ${score(after)}`);
    lines.push(`  Meilleur : ${best.join(' ') || '?'}`);
    if (reply.length) lines.push(`  Suite après le coup joué : ${reply.join(' ')}`);
    lines.push(`  FEN avant : ${parsed.fens[r.ply - 1]}`);
  }

  lines.push('', '## Évaluation après chaque coup');
  lines.push(parsed.moves.map((m, i) => `${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m.san} ${evals[i + 1] ? score(evals[i + 1]) : '?'}`).join(' '));
  lines.push('', '## PGN', cleanPgn(game, parsed));
  return lines.join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}
