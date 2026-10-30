const ZOOM_EPSILON = 0.01;
const DEBOUNCE_MS = 100;
const SETTLE_MS = 350;

const pendingRestore = new WeakSet<HTMLMetaElement>();

function isZoomedOrShifted(win: Window): boolean {
  const vv = win.visualViewport;
  if (!vv) return false;
  return vv.scale > 1 + ZOOM_EPSILON || Math.abs(vv.offsetLeft) > 1 || Math.abs(vv.offsetTop) > 1;
}

// iOS keeps the pinch-zoom scale/offset across rotations. Briefly pinning maximum-scale=1
// makes WebKit drop it; the original viewport content is restored on the next frame.
export function resetViewportZoom(win: Window): boolean {
  if (!isZoomedOrShifted(win)) return false;
  const meta = win.document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  // A restore already in flight owns the real original; never capture our own pinned value.
  if (meta && !pendingRestore.has(meta)) {
    const original = meta.getAttribute('content') ?? '';
    pendingRestore.add(meta);
    meta.setAttribute('content', `${original.replace(/,?\s*maximum-scale=[^,]*/i, '')}, maximum-scale=1`);
    const restore = () => {
      pendingRestore.delete(meta);
      meta.setAttribute('content', original);
    };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.requestAnimationFrame(restore));
    else win.setTimeout(restore, 50);
  }
  try { win.scrollTo(0, 0); } catch { /* scrollTo may be unavailable */ }
  return true;
}

export function watchViewportReset(win: Window): () => void {
  let debounce: number | undefined;
  let settle: number | undefined;
  const run = () => {
    if (debounce) win.clearTimeout(debounce);
    if (settle) win.clearTimeout(settle);
    debounce = win.setTimeout(() => resetViewportZoom(win), DEBOUNCE_MS);
    // iOS reports the final geometry some time after the rotation event.
    settle = win.setTimeout(() => resetViewportZoom(win), SETTLE_MS);
  };
  const vv = win.visualViewport;
  win.addEventListener('orientationchange', run);
  win.addEventListener('resize', run);
  vv?.addEventListener('resize', run);
  return () => {
    if (debounce) win.clearTimeout(debounce);
    if (settle) win.clearTimeout(settle);
    win.removeEventListener('orientationchange', run);
    win.removeEventListener('resize', run);
    vv?.removeEventListener('resize', run);
  };
}
