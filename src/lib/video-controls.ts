// UI-only coordinator. Timers always read current intent, including while YouTube buffers.
export class VideoControls {
  playing = false;
  pointerInside = false;
  keyboardFocus = false;
  seekingPointerId: number | null = null;
  private keyboardInput = false;
  private ignoreMouseUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private visible = true;
  private safeZone = false;
  private lastPointer = { x: -1, y: -1 };

  constructor(private readonly onVisibility: (visible: boolean) => void) {}

  isPinned() {
    return !this.playing || this.keyboardFocus || this.seekingPointerId !== null;
  }

  clear() {
    this.generation++;
    this.safeZone = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private show(visible: boolean) {
    this.visible = visible;
    this.onVisibility(visible);
  }

  schedule(delay = 2500) {
    this.clear();
    if (this.isPinned()) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation && !this.isPinned()) this.show(false);
    }, delay);
  }

  reveal(delay = 2500) {
    this.show(true);
    this.schedule(delay);
  }

  resume() {
    if (this.isPinned()) this.reveal();
    else if (this.pointerInside) this.schedule();
    else {
      this.clear();
      this.show(false);
    }
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    if (!playing) this.reveal();
    else this.resume();
  }

  keyDown() {
    this.keyboardInput = true;
  }

  pointerInput(pointerType: string) {
    if (pointerType === 'mouse' && Date.now() < this.ignoreMouseUntil) return false;
    if (pointerType === 'touch') this.ignoreMouseUntil = Date.now() + 800;
    this.keyboardInput = false;
    this.keyboardFocus = false;
    this.pointerInside = true;
    this.reveal();
    return true;
  }

  focus() {
    this.keyboardFocus = this.keyboardInput;
    this.reveal();
  }

  blur() {
    this.keyboardFocus = false;
    this.resume();
  }

  pointerEnter(x: number, y: number, pointerType: string) {
    if (pointerType === 'touch' || Date.now() < this.ignoreMouseUntil) return;
    this.pointerInside = true;
    this.lastPointer = { x, y };
    this.reveal();
  }

  pointerLeave(pointerType: string) {
    if (pointerType === 'touch') return;
    this.pointerInside = false;
    this.resume();
  }

  pointerMove(x: number, y: number, fullscreen: boolean, rect: { left: number; bottom: number; width: number }, pointerType: string) {
    if (pointerType === 'touch' || Date.now() < this.ignoreMouseUntil) return;
    this.pointerInside = true;
    const distance = Math.hypot(x - this.lastPointer.x, y - this.lastPointer.y);
    const hadPointer = this.lastPointer.x >= 0;
    this.lastPointer = { x, y };
    if (fullscreen && y < rect.bottom - 80 && x - rect.left < rect.width * 0.12 && !this.isPinned()) {
      // Keep the safe zone's deadline; repeated movement must not restart it.
      if (this.visible && !this.safeZone) {
        this.schedule(600);
        this.safeZone = true;
      }
      return;
    }
    if (hadPointer && distance < (fullscreen ? 6 : 3)) return;
    this.reveal();
  }

  beginSeek(pointerId: number) {
    if (this.seekingPointerId !== null) return false;
    this.seekingPointerId = pointerId;
    this.reveal();
    return true;
  }

  endSeek(pointerId?: number) {
    if (this.seekingPointerId === null || (pointerId !== undefined && pointerId !== this.seekingPointerId)) return false;
    this.seekingPointerId = null;
    this.resume();
    return true;
  }

  windowBlur() {
    this.keyboardFocus = false;
    this.seekingPointerId = null;
    this.pointerInside = false;
    this.resume();
  }

  reset() {
    this.clear();
    this.playing = false;
    this.pointerInside = false;
    this.keyboardFocus = false;
    this.keyboardInput = false;
    this.seekingPointerId = null;
    this.ignoreMouseUntil = 0;
    this.lastPointer = { x: -1, y: -1 };
    this.show(true);
  }
}
