// Ordre d'affichage du bilan, du meilleur au pire.
export const CLASSES = {
  brilliant: { label: 'Génial', symbol: '!!' },
  great: { label: 'Très bon', symbol: '!' },
  best: { label: 'Meilleur', symbol: '★' },
  excellent: { label: 'Excellent', symbol: '✓✓' },
  good: { label: 'Bon', symbol: '✓' },
  book: { label: 'Théorie', symbol: '📖' },
  inaccuracy: { label: 'Imprécision', symbol: '?!' },
  mistake: { label: 'Erreur', symbol: '?' },
  miss: { label: 'Occasion manquée', symbol: '✕' },
  blunder: { label: 'Gaffe', symbol: '??' },
};

const LAMP_ICON = '<svg class="coach-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6.5 6.5 0 0 0-4 11.6c.8.7 1.2 1.5 1.3 2.4h5.4c.1-.9.5-1.7 1.3-2.4A6.5 6.5 0 0 0 12 3Z"/></svg>';

// Encadré commun aux textes du coach. Le contenu doit déjà être échappé.
export const coachBox = (html) => `<div class="coach-box">${LAMP_ICON}<div class="coach-body">${html}</div></div>`;

export const BAD_CLASSES =new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

const CADENCES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Quotidienne' };
export const cadence = (timeClass) => CADENCES[timeClass] ?? timeClass;

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmtDate = (seconds) => new Date(seconds * 1000).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export const fmtPct = (value, digits = 0) => `${value.toFixed(digits).replace('.', ',')} %`;
