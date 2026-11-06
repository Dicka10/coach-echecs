// Port fidèle de la méthode publique de Lichess (lila AGPL-3.0, scalachess MIT).
// Sources : scalachess eval.scala, lila AccuracyPercent.scala, lila Advice.scala.
//
// Un score est toujours exprimé du point de vue des blancs :
//   { cp: 35 }     avantage en centipions
//   { mate: -3 }   mat en 3 pour les noirs
//   { over: 'w' }  échec et mat sur l'échiquier, gagné par les blancs ('b' pour les noirs)
// Le pat et les nulles terminées valent { cp: 0 }.

const MULTIPLIER = -0.00368208;
const CEILING = 1000;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const winningChances = (cp) => clamp(2 / (1 + Math.exp(MULTIPLIER * cp)) - 1, -1, 1);

export const winPercentFromCp = (cp) => 50 + 50 * winningChances(clamp(cp, -CEILING, CEILING));

const isCp = (s) => s.cp !== undefined;

// Score vu par une couleur : { kind: 'cp'|'mate'|'mated'|'given', v }
function pov(score, color) {
  const sign = color === 'w' ? 1 : -1;
  if (isCp(score)) return { kind: 'cp', v: score.cp * sign };
  if (score.mate !== undefined) return { kind: 'mate', v: score.mate * sign };
  return { kind: score.over === color ? 'given' : 'mated', v: 0 };
}

// WinPercent.fromScore : les mats comptent comme le plafond de ±1000 cp.
export function winPercent(score, color = 'w') {
  const s = pov(score, color);
  if (s.kind === 'cp') return winPercentFromCp(s.v);
  if (s.kind === 'given' || (s.kind === 'mate' && s.v > 0)) return winPercentFromCp(CEILING);
  return winPercentFromCp(-CEILING);
}

// AccuracyPercent.fromWinPercents
export function accuracyFromWinPercents(before, after) {
  if (after >= before) return 100;
  const winDiff = before - after;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

export function moveAccuracy(prev, cur, mover) {
  return accuracyFromWinPercents(winPercent(prev, mover), winPercent(cur, mover));
}

function forceAsCp(score) {
  if (isCp(score)) return score.cp;
  if (score.mate !== undefined) return score.mate > 0 ? CEILING : -CEILING;
  return score.over === 'w' ? CEILING : -CEILING;
}

function standardDeviation(values) {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const weightedMean = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  return total > 0 ? pairs.reduce((a, [v, w]) => a + v * w, 0) / total : null;
};

const harmonicMean = (values) =>
  values.length ? values.length / values.reduce((a, v) => a + 1 / Math.max(1, v), 0) : null;

// AccuracyPercent.gameAccuracy : moyenne d'une moyenne pondérée par la volatilité
// et d'une moyenne harmonique. Attend N+1 scores pour N demi-coups.
export function gameAccuracy(scores, startColor = 'w') {
  if (scores.length < 3) return null;
  const wins = scores.map((s) => winPercentFromCp(forceAsCp(s)));
  const windowSize = clamp(Math.floor((scores.length - 1) / 10), 2, 8);
  const windows = [];
  const padding = Math.min(windowSize, wins.length) - 2;
  for (let i = 0; i < padding; i++) windows.push(wins.slice(0, windowSize));
  for (let i = 0; i + windowSize <= wins.length; i++) windows.push(wins.slice(i, i + windowSize));
  const weights = windows.map((w) => clamp(standardDeviation(w), 0.5, 12));

  const perColor = { w: [], b: [] };
  for (let i = 0; i + 1 < wins.length && i < weights.length; i++) {
    const color = (i % 2 === 0) === (startColor === 'w') ? 'w' : 'b';
    const [prev, next] = [wins[i], wins[i + 1]];
    const accuracy = color === 'w'
      ? accuracyFromWinPercents(prev, next)
      : accuracyFromWinPercents(next, prev);
    perColor[color].push([accuracy, weights[i]]);
  }
  const forColor = (c) => {
    const weighted = weightedMean(perColor[c]);
    const harmonic = harmonicMean(perColor[c].map(([a]) => a));
    return weighted === null || harmonic === null ? null : (weighted + harmonic) / 2;
  };
  return { w: forColor('w'), b: forColor('b') };
}

// Advice.scala. Retourne 'inaccuracy', 'mistake', 'blunder' ou null.
export function judgement(prev, cur, mover) {
  if (isCp(prev) && isCp(cur)) {
    const delta = winningChances(cur.cp) - winningChances(prev.cp);
    const drop = mover === 'w' ? -delta : delta;
    if (drop >= 0.3) return 'blunder';
    if (drop >= 0.2) return 'mistake';
    if (drop >= 0.1) return 'inaccuracy';
    return null;
  }
  const before = pov(prev, mover);
  const after = pov(cur, mover);
  const created = before.kind === 'cp'
    && ((after.kind === 'mate' && after.v < 0) || after.kind === 'mated');
  const lost = before.kind === 'mate' && before.v > 0
    && (after.kind === 'cp' || (after.kind === 'mate' && after.v < 0) || after.kind === 'mated');
  if (created) {
    if (before.v < -999) return 'inaccuracy';
    if (before.v < -700) return 'mistake';
    return 'blunder';
  }
  if (lost) {
    const afterCp = after.kind === 'cp' ? after.v : 0;
    if (afterCp > 999) return 'inaccuracy';
    if (afterCp > 700) return 'mistake';
    return 'blunder';
  }
  return null;
}

// Lichess ne connaît que trois alertes. « Meilleur » et « Bon » n'ajoutent aucun seuil :
// meilleur = le coup de Stockfish, bon = aucune alerte.
export function classify(prev, cur, mover, playedUci, bestUci) {
  if (bestUci && playedUci === bestUci) return 'best';
  return judgement(prev, cur, mover) ?? 'good';
}
