// Fournisseurs d'IA. Pour en ajouter un : créer un objet avec la même forme dans PROVIDERS.
// La clé reste sur l'appareil et part uniquement vers le fournisseur choisi, dans un en-tête.

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'key', 'quota', 'model', 'blocked', 'network', 'format', 'server'
  }
}

const REQUEST_TIMEOUT_MS = 90000;
// Coupe net une réponse qui part en boucle. La réflexion du modèle compte dans cette limite.
const MAX_OUTPUT_TOKENS = 8192;

async function send(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AiError('timeout', 'L\'IA met trop de temps à répondre. Garde l\'écran allumé pendant l\'attente, ou essaie un autre modèle.');
    }
    throw new AiError('network', 'Connexion à l\'IA impossible. Vérifie ton accès à Internet.');
  } finally {
    clearTimeout(timer);
  }
}

// ---- Google Gemini ----
// generateContent est utilisé car l'API Interactions exige l'en-tête Api-Revision,
// refusé par Google lors de la vérification CORS d'un appel depuis un navigateur.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function geminiError(res) {
  let text = '';
  try {
    text = (await res.text()).toLowerCase();
  } catch { /* corps illisible : le code HTTP suffit */ }

  if (res.status === 401 || text.includes('api key') || text.includes('api_key')) {
    if (text.includes('leaked')) return new AiError('key', 'Google signale cette clé comme divulguée. Crée-en une nouvelle dans Google AI Studio.');
    return new AiError('key', 'Clé Gemini refusée. Vérifie-la dans les réglages.');
  }
  if (res.status === 403) return new AiError('key', 'Cette clé n\'a pas accès à ce service. Vérifie ton projet dans Google AI Studio.');
  if (res.status === 404) return new AiError('model', 'Ce modèle n\'est plus disponible. Choisis-en un autre dans les réglages.');
  if (res.status === 429) {
    if (text.includes('perminute')) return new AiError('quota', 'Trop de demandes à Gemini en peu de temps. Réessaie dans une minute.');
    if (text.includes('perday')) {
      return new AiError('quota', 'Quota gratuit du jour atteint pour ce modèle. Réessaie demain, ou change de modèle dans les réglages.');
    }
    return new AiError('quota', 'Limite gratuite de Gemini atteinte. Réessaie plus tard, ou change de modèle dans les réglages.');
  }
  if (res.status === 400) return new AiError('request', 'Gemini a refusé la demande (erreur 400).');
  if (res.status >= 500) return new AiError('server', 'Gemini est momentanément surchargé. Réessaie dans quelques minutes.');
  return new AiError('server', `Gemini a répondu avec une erreur (${res.status}).`);
}

function geminiText(data) {
  if (data?.promptFeedback?.blockReason) throw new AiError('blocked', 'Gemini a bloqué cette demande. Réessaie plus tard.');
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new AiError('format', 'La réponse de Gemini a été coupée car elle était trop longue. Réessaie ou essaie un autre modèle.');
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text && candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new AiError('blocked', `Gemini n'a pas terminé sa réponse (${candidate.finishReason}). Réessaie.`);
  }
  return text;
}

const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  models: [
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (conseillé)', short: 'Flash-Lite' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (à essayer)', short: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (ne répond pas en test)', short: 'Gemini 3.8 Flash' },
  ],

  // Ne consomme pas de quota de génération. Google précise qu'elle valide l'existence de la clé.
  async checkKey(key) {
    const res = await send(`${GEMINI_BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await geminiError(res);
  },

  async generateJson({ system, prompt, schema, formatHint = '' }, { key, model }) {
    const post = (instructions, generationConfig) => send(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_OUTPUT_TOKENS, ...generationConfig },
      }),
    });
    // Le format est donné par le schéma seul : Google déconseille de préciser l'ordre des champs
    // dans le texte, car cela peut faire boucler la réponse.
    let res = await post(system, { responseJsonSchema: schema, thinkingConfig: { thinkingLevel: 'LOW' } });
    if (!res.ok) {
      const error = await geminiError(res);
      if (error.kind !== 'request') throw error;
      // Un réglage refusé ne produit aucune réponse : on redemande avec le JSON seul.
      res = await post(`${system}\n\n${formatHint}`, {});
      if (!res.ok) throw await geminiError(res);
    }
    const text = geminiText(await res.json());
    if (!text) throw new AiError('format', 'Gemini n\'a pas renvoyé de texte. Réessaie.');
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError('format', 'La réponse de Gemini était illisible. Réessaie.');
    }
  },
};

export const PROVIDERS = { gemini };
export const DEFAULT_PROVIDER = 'gemini';
