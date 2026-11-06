// Écriture des coups et des évaluations.
import { Chess } from '../vendor/chess.js';

const FIGURES = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
const PIECE_MOVE = /\b[KQRBN][a-h1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?/g;

export const figurine = (san) => san.replace(/[KQRBN]/g, (c) => `${FIGURES[c]}︎`);

// Dans une phrase, seuls les coups de pièces changent : les mots restent intacts.
export const figurineInText = (text) => text.replace(PIECE_MOVE, figurine);

// Coups de pièces cités dans un texte, sans les signes + et #.
export const pieceMovesIn = (text) => (text.match(PIECE_MOVE) ?? []).map(cleanSan);
export const cleanSan = (san) => san.replace(/[+#]/g, '');

export function pvToSan(fen, pv) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of (pv || '').split(' ').filter(Boolean)) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(move.san);
    } catch { break; }
  }
  return out;
}

export function evalText(score, color) {
  if (!score) return '';
  if (score.over) return score.over === color ? 'Mat' : 'Maté';
  const sign = color === 'w' ? 1 : -1;
  if (score.mate !== undefined) return `${score.mate * sign > 0 ? '+' : '-'}M${Math.abs(score.mate)}`;
  const pawns = (score.cp * sign) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1).replace('.', ',')}`;
}

export const moveNumber = (ply) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;
