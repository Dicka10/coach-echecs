export const CLASSES = {
  best: { label: 'Meilleur', symbol: '★' },
  good: { label: 'Bon', symbol: '✓' },
  inaccuracy: { label: 'Imprécision', symbol: '?!' },
  mistake: { label: 'Erreur', symbol: '?' },
  blunder: { label: 'Gaffe', symbol: '??' },
};

const CADENCES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Quotidienne' };
export const cadence = (timeClass) => CADENCES[timeClass] ?? timeClass;

export const esc =(value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmtDate = (seconds) => new Date(seconds * 1000).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export const fmtPct = (value, digits = 0) => `${value.toFixed(digits).replace('.', ',')} %`;
