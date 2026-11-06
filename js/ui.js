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

export const BAD_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

const CADENCES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Quotidienne' };
export const cadence = (timeClass) => CADENCES[timeClass] ?? timeClass;

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmtDate = (seconds) => new Date(seconds * 1000).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export const fmtPct = (value, digits = 0) => `${value.toFixed(digits).replace('.', ',')} %`;
