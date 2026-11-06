// Courbe de mes chances de gain, de 0 à 100 %, centrée sur mon point de vue.
const NS = 'http://www.w3.org/2000/svg';
const SEVERE = new Set(['inaccuracy', 'mistake', 'blunder']);

export function renderChart(container, { points, marks, current, total, onSelect }) {
  const width = Math.max(container.clientWidth, 200);
  const height = 96;
  const pad = 6;
  const xAt = (ply) => (total > 0 ? (ply / total) * width : 0);
  const yAt = (pct) => pad + ((100 - pct) / 100) * (height - pad * 2);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Courbe de mes chances de gain');

  const add = (name, attrs) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
    return el;
  };

  add('line', { x1: 0, x2: width, y1: yAt(50), y2: yAt(50), class: 'chart-mid' });
  if (points.length > 1) {
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.ply).toFixed(1)} ${yAt(p.pct).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    const first = points[0];
    add('path', { d: `${path} L${xAt(last.ply).toFixed(1)} ${height} L${xAt(first.ply).toFixed(1)} ${height} Z`, class: 'chart-area' });
    add('path', { d: path, class: 'chart-line' });
  }
  for (const m of marks) {
    if (!SEVERE.has(m.cls)) continue;
    add('circle', { cx: xAt(m.ply), cy: yAt(m.pct), r: 3.5, class: `chart-dot cls-${m.cls}` });
  }
  add('line', { x1: xAt(current), x2: xAt(current), y1: 0, y2: height, class: 'chart-cursor' });

  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    onSelect(Math.round(((e.clientX - rect.left) / rect.width) * total));
  });
  container.replaceChildren(svg);
}
