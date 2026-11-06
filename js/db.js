// Petit accès à IndexedDB. Trois magasins :
//   games     parties récupérées sur Chess.com
//   analyses  analyses Stockfish, sauvegardées position par position
//   kv        réglages et état de l'appli

const DB_NAME = 'coach-echecs';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('games', { keyPath: 'uuid' });
      db.createObjectStore('analyses', { keyPath: 'uuid' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // iOS peut fermer la base en arrière-plan : on la rouvrira au prochain accès.
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run(store, mode, action) {
  let db = await open();
  let tx;
  try {
    tx = db.transaction(store, mode);
  } catch {
    dbPromise = null;
    db = await open();
    tx = db.transaction(store, mode);
  }
  return new Promise((resolve, reject) => {
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const put = (store, value, key) => run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

export async function putMany(store, values) {
  if (values.length === 0) return;
  await run(store, 'readwrite', (s) => {
    let last;
    for (const v of values) last = s.put(v);
    return last;
  });
}

export const kvGet = (key, fallback) => get('kv', key).then((v) => (v === undefined ? fallback : v));
export const kvSet = (key, value) => put('kv', value, key);
