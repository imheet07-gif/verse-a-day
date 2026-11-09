// Test-mode switches, read once from the URL.
//   ?fake-remote=1            use the in-page FakeRemote (localhost / 127.0.0.1 only)
//   ?fake-remote=1&device=b   additionally namespace the LOCAL journal keys, so a
//                             second tab can stand in for a second device while
//                             sharing the same fake remote.
// Outside fake mode neither switch does anything, so real users always get the
// plain `vad:` keys.

function read() {
  try {
    const loc = globalThis.location;
    if (!loc || !['localhost', '127.0.0.1'].includes(loc.hostname)) return { fake: false, device: '' };
    const q = new URLSearchParams(loc.search);
    if (q.get('fake-remote') !== '1') return { fake: false, device: '' };
    const d = (q.get('device') || '').toLowerCase();
    return { fake: true, device: /^[a-z0-9]{1,8}$/.test(d) ? d : '' };
  } catch {
    return { fake: false, device: '' };
  }
}

export const { fake: FAKE_MODE, device: DEVICE } = read();
/** Key namespace for this device's local data: '' normally, 'd-b:' for ?device=b. */
export const NS = DEVICE ? `d-${DEVICE}:` : '';
