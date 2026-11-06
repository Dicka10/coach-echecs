// Récupération des parties via l'API publique de Chess.com (sans clé).
import * as db from './db.js';

const BASE = 'https://api.chess.com/pub/player/';
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export class ChessComError extends Error {}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ChessComError('Connexion à Chess.com impossible. Vérifie ton accès à Internet.');
  }
  if (res.status === 404) throw new ChessComError('Pseudo introuvable sur Chess.com.');
  if (res.status === 429) throw new ChessComError('Chess.com limite les demandes pour le moment. Réessaie dans une minute.');
  if (!res.ok) throw new ChessComError(`Chess.com a répondu avec une erreur (${res.status}).`);
  return res.json();
}

export function normalizeGame(raw, me) {
  const lower = me.toLowerCase();
  const color = raw.white.username.toLowerCase() === lower ? 'w' : 'b';
  const mine = color === 'w' ? raw.white : raw.black;
  const opp = color === 'w' ? raw.black : raw.white;
  const result = mine.result === 'win' ? 'win' : DRAWS.has(mine.result) ? 'draw' : 'loss';
  return {
    uuid: raw.uuid,
    me: lower,
    url: raw.url,
    end_time: raw.end_time,
    time_class: raw.time_class,
    time_control: raw.time_control,
    rated: raw.rated,
    pgn: raw.pgn,
    eco: raw.eco ?? '',
    color,
    result,
    myRating: mine.rating,
    opponent: opp.username,
    oppRating: opp.rating,
  };
}

export function openingName(game) {
  const slug = (game.eco || '').split('/openings/')[1];
  if (!slug) return 'Ouverture inconnue';
  // L'adresse contient aussi les coups joués : « Indian-Game-Knights-Variation-2...e6-3.Nc3-d5 »
  const name = slug.split(/-\d+\.+/)[0].replace(/-/g, ' ').trim();
  return name || 'Ouverture inconnue';
}

async function saveArchive(url, me) {
  const data = await getJson(url);
  const games = (data.games ?? [])
    .filter((g) => g.rules === 'chess' && g.uuid && g.pgn)
    .map((g) => normalizeGame(g, me));
  await db.putMany('games', games);
  return games.length;
}

// Charge les mois les plus récents jusqu'à obtenir assez de nouvelles parties.
export async function refresh(me, { minGames = 30 } = {}) {
  const { archives = [] } = await getJson(`${BASE}${encodeURIComponent(me.toLowerCase())}/games/archives`);
  const ordered = [...archives].reverse();
  const key = `oldestLoaded:${me.toLowerCase()}`;
  let oldest = await db.kvGet(key, 0);
  let total = 0;
  let index = 0;
  while (index < ordered.length && (index < 1 || (total < minGames && index >= oldest))) {
    total += await saveArchive(ordered[index], me);
    index += 1;
  }
  oldest = Math.max(oldest, index);
  await db.kvSet(key, oldest);
  return { hasMore: oldest < ordered.length };
}

// Bouton « Charger plus » : ajoute un mois plus ancien contenant des parties.
export async function loadOlder(me) {
  const { archives = [] } = await getJson(`${BASE}${encodeURIComponent(me.toLowerCase())}/games/archives`);
  const ordered = [...archives].reverse();
  const key = `oldestLoaded:${me.toLowerCase()}`;
  let oldest = await db.kvGet(key, 0);
  let added = 0;
  while (oldest < ordered.length && added === 0) {
    added = await saveArchive(ordered[oldest], me);
    oldest += 1;
  }
  await db.kvSet(key, oldest);
  return { hasMore: oldest < ordered.length };
}

export async function listGames(me) {
  const lower = me.toLowerCase();
  const all = await db.getAll('games');
  return all.filter((g) => g.me === lower).sort((a, b) => b.end_time - a.end_time);
}
