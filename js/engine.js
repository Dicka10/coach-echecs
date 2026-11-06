// Pilote Stockfish dans un Web Worker, en monothread pour fonctionner sur GitHub Pages.

const WORKER_URL = 'vendor/stockfish-19-lite-single.js';
const STALL_LIMIT_MS = 20000;

export class EngineStalled extends Error {}

export class Engine {
  constructor() {
    this.worker = null;
    this.onLine = null;
    this.lastActivity = 0;
  }

  async start() {
    this.terminate();
    this.worker = new Worker(WORKER_URL);
    this.worker.onmessage = (e) => {
      this.lastActivity = Date.now();
      const line = typeof e.data === 'string' ? e.data : '';
      this.onLine?.(line);
    };
    this.worker.onerror = (e) => this.fail?.(new Error(e.message || 'Erreur du moteur'));
    this.send('uci');
    await this.waitFor('uciok');
    this.send('setoption name Hash value 32');
    this.send('setoption name MultiPV value 1');
    this.send('isready');
    await this.waitFor('readyok');
    this.send('ucinewgame');
    this.send('isready');
    await this.waitFor('readyok');
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }

  send(command) {
    this.worker.postMessage(command);
  }

  // Attend une ligne du moteur. Quand la page est cachée, le système peut figer le moteur :
  // la surveillance s'arrête alors et repart au retour sur l'appli.
  waitFor(prefix, onOther) {
    return new Promise((resolve, reject) => {
      this.lastActivity = Date.now();
      const onVisible = () => { this.lastActivity = Date.now(); };
      const finish = (fn, value) => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        this.onLine = null;
        this.fail = null;
        fn(value);
      };
      const timer = setInterval(() => {
        if (document.hidden) return;
        if (Date.now() - this.lastActivity > STALL_LIMIT_MS) {
          finish(reject, new EngineStalled('Le moteur ne répond plus'));
        }
      }, 1000);
      document.addEventListener('visibilitychange', onVisible);
      this.fail = (err) => finish(reject, err);
      this.onLine = (line) => {
        if (line.startsWith(prefix)) finish(resolve, line);
        else onOther?.(line);
      };
    });
  }

  // position : commande UCI complète. turn : 'w' ou 'b'.
  async analyse(position, turn, { depth, movetime, searchmoves }) {
    let best = null;
    const onInfo = (line) => {
      const parsed = parseInfo(line);
      if (parsed) best = parsed;
    };
    this.send(position);
    const restrict = searchmoves?.length ? ` searchmoves ${searchmoves.join(' ')}` : '';
    this.send(`go depth ${depth} movetime ${movetime}${restrict}`);
    const final = await this.waitFor('bestmove', onInfo);
    const move = final.split(/\s+/)[1];
    if (!best) throw new Error('Aucune évaluation reçue du moteur');
    const sign = turn === 'w' ? 1 : -1;
    const score = best.mate !== undefined ? { mate: best.mate * sign } : { cp: best.cp * sign };
    return { s: score, b: move && move !== '(none)' ? move : null, p: best.pv, d: best.depth };
  }

  async stopSearch() {
    if (!this.worker) return;
    this.send('stop');
  }
}

// Garde uniquement les lignes finales : pas de borne inférieure ou supérieure.
export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' score ') || !line.includes(' pv ')) return null;
  if (line.includes(' lowerbound') || line.includes(' upperbound')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  const pv = / pv (.+)$/.exec(line);
  if (!depth || !score || !pv) return null;
  const value = Number(score[2]);
  return {
    depth: Number(depth[1]),
    ...(score[1] === 'cp' ? { cp: value } : { mate: value }),
    pv: pv[1].trim().split(/\s+/).slice(0, 8).join(' '),
  };
}
