// Tiny key/value wrapper over localStorage. Every access is guarded: if storage
// is blocked (private mode, disabled cookies) values live in memory for the
// session and `persistent` is false so the UI can say so honestly.
//
// makeKv(backend) builds a wrapper over any localStorage-like object (or null
// for memory only). The app uses one over window.localStorage; the node tests
// build several over plain maps to simulate separate devices.

export function makeKv(store) {
  const mem = new Map();
  return {
    persistent: !!store,
    get(k) {
      try {
        if (store) {
          const v = store.getItem(k);
          if (v !== null) return v;
        }
      } catch {
        /* fall through to memory */
      }
      return mem.has(k) ? mem.get(k) : null;
    },
    /** @returns {boolean} true when the value reached real storage */
    set(k, v) {
      try {
        if (store) {
          store.setItem(k, v);
          mem.delete(k);
          return true;
        }
      } catch {
        /* quota or blocked */
      }
      mem.set(k, v);
      return false;
    },
    remove(k) {
      mem.delete(k);
      try {
        store && store.removeItem(k);
      } catch {
        /* ignore */
      }
    },
    keys(prefix = '') {
      const out = new Set([...mem.keys()].filter((k) => k.startsWith(prefix)));
      try {
        if (store) {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k && k.startsWith(prefix)) out.add(k);
          }
        }
      } catch {
        /* ignore */
      }
      return [...out];
    },
  };
}

function open() {
  try {
    const s = window.localStorage;
    s.setItem('vad:__probe', '1');
    s.removeItem('vad:__probe');
    return s;
  } catch {
    return null;
  }
}

export const kv = makeKv(open());
export const persistent = kv.persistent;
