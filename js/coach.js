// Explications du coach : un seul appel par partie, couvrant tous les moments clés.
// L'IA reçoit uniquement des données calculées par Stockfish et n'en invente pas d'autres.
import { DEFAULT_PROVIDER, AiError, PROVIDERS } from './ai.js';
import * as db from './db.js';
import { cleanSan, evalText, moveNumber, pieceMovesIn, pvToSan } from './notation.js';
import { BAD_CLASSES, CLASSES } from './ui.js';

const MAX_MOMENTS = 8;
const POSITIVE = new Set(['brilliant', 'great']);
const inFlight = new Map();

const storageKey = (uuid) => `coach:${uuid}`;
export const loadCoach = (uuid) => db.kvGet(storageKey(uuid), null);
export const deleteCoach = (uuid) => db.del('kv', storageKey(uuid));

// Mes coups les plus marquants, dans l'ordre de la partie.
export function keyMoments(reviewed, myColor) {
  const mine = reviewed.filter((r) => r && r.color === myColor && (BAD_CLASSES.has(r.cls) || POSITIVE.has(r.cls)));
  const weight = (r) => (POSITIVE.has(r.cls) ? 100 : r.before - r.after);
  return [...mine].sort((a, b) => weight(b) - weight(a)).slice(0, MAX_MOMENTS).sort((a, b) => a.ply - b.ply);
}

function momentData(record, parsed, evals, myColor) {
  const index = record.ply - 1;
  const best = pvToSan(parsed.fens[index], record.pv || record.best);
  return {
    ply: record.ply,
    numero: moveNumber(record.ply),
    coup_joue: parsed.moves[index].san,
    categorie: CLASSES[record.cls].label,
    constat_stockfish: record.note,
    mes_chances_avant_pct: Math.round(record.before),
    mes_chances_apres_pct: Math.round(record.after),
    eval_apres: evalText(evals[record.ply].s, myColor),
    meilleur_coup: best[0] ?? null,
    suite_si_meilleur_coup: best,
    suite_apres_le_coup_joue: pvToSan(parsed.fens[record.ply], evals[record.ply].p),
    position_avant_fen: parsed.fens[index],
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    resume: { type: 'string', description: 'Résumé de la partie en deux phrases.' },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ply: { type: 'integer' },
          explication: { type: 'string', description: 'Une ou deux phrases sur ce moment.' },
        },
        required: ['ply', 'explication'],
      },
    },
  },
  required: ['resume', 'moments'],
};

function buildSystem(game) {
  return `Tu es un coach d'échecs bienveillant qui écrit en français et tutoie le joueur.
Le joueur a environ ${game.myRating} Elo : utilise des mots simples.

Règles obligatoires :
- Tu ne calcules jamais de coup. Stockfish a tout calculé. Cite uniquement des coups présents dans les données.
- Écris les coups exactement comme dans les données, en notation anglaise (exemple : Nf3).
- N'invente aucun motif tactique, aucune menace et aucune évaluation. Déduis tes explications des variantes fournies.
- Si les données ne suffisent pas à expliquer un moment, reste général et dis-le simplement.
- Pour chaque moment, écris une ou deux phrases : ce qui s'est passé et l'idée à retenir.
- Réponds pour chaque valeur de "ply" reçue.
- Sois concis, donne ta réponse une seule fois et ne te répète pas.
- Dans les textes, les seuls échappements permis sont \\\\, \\n et \\". Écris les accents directement en UTF-8.`;
}

function buildPrompt(game, parsed, moments, evals, openingTitle) {
  const data = {
    couleur_du_joueur: game.color === 'w' ? 'Blancs' : 'Noirs',
    resultat: { win: 'victoire', loss: 'défaite', draw: 'nulle' }[game.result],
    cadence: game.time_class,
    ouverture: openingTitle,
    nombre_de_coups: Math.ceil(parsed.moves.length / 2),
    moments: moments.map((m) => momentData(m, parsed, evals, game.color)),
  };
  return `Voici les données de Stockfish pour cette partie, au format JSON :\n${JSON.stringify(data)}`;
}

// Filet de sécurité : retire toute phrase citant un coup de pièce absent des données.
export function keepVerifiedSentences(text, allowed) {
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => pieceMovesIn(s).every((m) => allowed.has(m)));
  return kept.join(' ').trim();
}

function allowedMoves(parsed, moments, evals) {
  const allowed = new Set(parsed.moves.map((m) => cleanSan(m.san)));
  for (const m of moments) {
    for (const san of pvToSan(parsed.fens[m.ply - 1], m.pv || m.best)) allowed.add(cleanSan(san));
    for (const san of pvToSan(parsed.fens[m.ply], evals[m.ply].p)) allowed.add(cleanSan(san));
  }
  return allowed;
}

export function coachReady(settings) {
  return Boolean(settings.aiKeys?.[settings.aiProvider ?? DEFAULT_PROVIDER]);
}

// Retourne l'explication enregistrée, sinon fait l'unique appel à l'IA.
export function runCoach({ game, parsed, reviewed, evals, openingTitle, settings }) {
  if (inFlight.has(game.uuid)) return inFlight.get(game.uuid);
  const task = (async () => {
    const cached = await loadCoach(game.uuid);
    if (cached) return cached;
    const providerId = settings.aiProvider ?? DEFAULT_PROVIDER;
    const provider = PROVIDERS[providerId];
    const key = settings.aiKeys?.[providerId];
    if (!key) throw new AiError('key', 'Ajoute ta clé dans les réglages.');
    const model = settings.aiModel ?? provider.models[0].id;
    const moments = keyMoments(reviewed, game.color);
    if (moments.length === 0) {
      const empty = { resume: 'Aucun moment clé dans cette partie : tes coups ont suivi les choix de Stockfish.', moments: {}, model: null, createdAt: Date.now() };
      await db.kvSet(storageKey(game.uuid), empty);
      return empty;
    }
    const answer = await provider.generateJson({
      system: buildSystem(game),
      prompt: buildPrompt(game, parsed, moments, evals, openingTitle),
      schema: SCHEMA,
      formatHint: 'Réponds uniquement en JSON avec "resume" (deux phrases) et "moments" (liste de "ply" et "explication").',
    }, { key, model });

    const allowed = allowedMoves(parsed, moments, evals);
    const wanted = new Set(moments.map((m) => m.ply));
    const texts = {};
    for (const item of Array.isArray(answer?.moments) ? answer.moments : []) {
      if (!wanted.has(item?.ply)) continue;
      const text = keepVerifiedSentences(item.explication ?? '', allowed);
      if (text) texts[item.ply] = text;
    }
    const result = {
      resume: keepVerifiedSentences(answer?.resume ?? '', allowed),
      moments: texts,
      model,
      createdAt: Date.now(),
    };
    await db.kvSet(storageKey(game.uuid), result);
    return result;
  })().finally(() => inFlight.delete(game.uuid));
  inFlight.set(game.uuid, task);
  return task;
}
