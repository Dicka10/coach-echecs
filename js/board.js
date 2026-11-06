// Échiquier en lecture seule. Les 64 cases sont créées une fois puis mises à jour,
// ce qui évite tout scintillement pendant la navigation.

const FILES = 'abcdefgh';

export function createBoard(container, orientation) {
  container.classList.add('board');
  const squares = new Map();
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'w' ? [...FILES] : [...FILES].reverse();

  ranks.forEach((rank, y) => {
    files.forEach((file, x) => {
      const el = document.createElement('div');
      const light = (FILES.indexOf(file) + rank) % 2 === 1;
      el.dataset.color = light ? 'light' : 'dark';
      if (y === 7) el.dataset.file = file;
      if (x === 0) el.dataset.rank = rank;
      el.className = `sq ${el.dataset.color}`;
      container.append(el);
      squares.set(file + rank, { el, x, y });
    });
  });

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('viewBox', '0 0 8 8');
  overlay.setAttribute('class', 'board-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  container.append(overlay);

  const badge = document.createElement('div');
  badge.className = 'board-badge';
  badge.hidden = true;
  container.append(badge);

  return {
    render({ fen, lastMove, arrow, mark }) {
      const pieces = placement(fen);
      for (const [name, { el }] of squares) {
        const piece = pieces.get(name);
        const highlighted = lastMove && (lastMove.from === name || lastMove.to === name);
        el.className = `sq ${el.dataset.color}${highlighted ? ' last' : ''}${piece ? ` piece-${piece}` : ''}`;
      }
      overlay.replaceChildren();
      if (arrow) overlay.append(drawArrow(squares.get(arrow.from), squares.get(arrow.to)));
      if (mark && lastMove) {
        const { x, y } = squares.get(lastMove.to);
        badge.hidden = false;
        badge.className = `board-badge cls-${mark.cls}`;
        badge.textContent = mark.symbol;
        badge.style.left = `${Math.min((x + 1) * 12.5, 96)}%`;
        badge.style.top = `${y * 12.5}%`;
      } else {
        badge.hidden = true;
      }
    },
  };
}

function placement(fen) {
  const map = new Map();
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map.set(FILES[f] + (8 - r), color + ch.toUpperCase());
      f += 1;
    }
  });
  return map;
}

function drawArrow(from, to) {
  const ns = 'http://www.w3.org/2000/svg';
  const [x1, y1, x2, y2] = [from.x + 0.5, from.y + 0.5, to.x + 0.5, to.y + 0.5];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 0.42;
  const endX = x2 - Math.cos(angle) * head;
  const endY = y2 - Math.sin(angle) * head;
  const group = document.createElementNS(ns, 'g');
  group.setAttribute('class', 'arrow');
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', endX);
  line.setAttribute('y2', endY);
  const tip = document.createElementNS(ns, 'polygon');
  const wing = (a) => `${x2 - Math.cos(a) * head},${y2 - Math.sin(a) * head}`;
  tip.setAttribute('points', `${x2},${y2} ${wing(angle + 0.5)} ${wing(angle - 0.5)}`);
  group.append(line, tip);
  return group;
}
