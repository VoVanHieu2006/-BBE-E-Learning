export type FullscreenMode = 'NONE' | 'NATIVE' | 'THEATER' | 'UNAVAILABLE';

// A video replacement can create a controller before the previous entry finishes popping.
const pendingHistoryExits = new WeakSet<Window>();
const activeControllers = new WeakMap<HTMLElement, VideoFullscreen>();

// Owns only presentation and its own history entry; never moves/recreates the iframe.
export class VideoFullscreen {
  mode: FullscreenMode = 'NONE';
  private pending = false;
  private nativeRequested = false;
  private disposed = false;
  private requestId = 0;
  private historyWaiting = false;
  private historyToken = '';
  private historyUrl = '';
  private ancestors: HTMLElement[] = [];
  private readonly doc: Document;
  private readonly events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
  private readonly errors = ['fullscreenerror', 'webkitfullscreenerror'];

  constructor(private readonly wrapper: HTMLElement, private readonly onChange: (mode: FullscreenMode) => void) {
    this.doc = wrapper.ownerDocument;
    activeControllers.set(wrapper, this);
    this.events.forEach(event => this.doc.addEventListener(event, this.handleChange));
    this.errors.forEach(event => this.doc.addEventListener(event, this.handleError));
    this.win.addEventListener('popstate', this.handlePopState);
    this.win.addEventListener('pagehide', this.handlePageHide);
  }

  private get win() { return this.doc.defaultView!; }
  private get nativeElement(): Element | null {
    const doc = this.doc as any;
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || null;
  }

  private update(mode: FullscreenMode) {
    this.mode = mode;
    if (!this.disposed) this.onChange(mode);
  }

  private ownsHistory() {
    return this.historyToken && this.win.history.state?.bbeTheater === this.historyToken && this.win.location.href === this.historyUrl;
  }

  private consumeHistory() {
    if (this.ownsHistory()) {
      this.historyWaiting = true;
      pendingHistoryExits.add(this.win);
      this.win.addEventListener('popstate', () => pendingHistoryExits.delete(this.win), { once: true });
      this.win.history.back();
    }
    this.historyToken = '';
  }

  private removeTheater() {
    this.ancestors.forEach(element => element.classList.remove('bbe-theater-ancestor'));
    this.ancestors = [];
    this.doc.documentElement.classList.remove('bbe-fullscreen-locked');
    this.doc.body.classList.remove('bbe-fullscreen-locked');
    this.wrapper.classList.remove('bbe-player-fullscreen');
  }

  private enterTheater() {
    if (this.disposed || this.mode === 'THEATER') return;
    this.pending = false;
    this.nativeRequested = false;
    try {
      this.wrapper.classList.add('bbe-player-fullscreen');
      // Neutralize ancestor containing blocks without moving or reloading the iframe
      for (let element = this.wrapper.parentElement; element; element = element.parentElement) {
        if (!element.classList.contains('bbe-theater-ancestor')) {
          element.classList.add('bbe-theater-ancestor');
          this.ancestors.push(element);
        }
      }
      this.doc.documentElement.classList.add('bbe-fullscreen-locked');
      this.doc.body.classList.add('bbe-fullscreen-locked');
      if (!this.wrapper.isConnected || this.win.getComputedStyle(this.wrapper).position !== 'fixed') throw new Error('Viewport presentation unavailable');
      this.historyToken = crypto.randomUUID();
      this.historyUrl = this.win.location.href;
      try {
        // Preserve Next.js's router state. Only theater needs a synthetic Back entry.
        this.win.history.pushState({ ...this.win.history.state, bbeTheater: this.historyToken }, '');
      } catch { this.historyToken = ''; }
      this.update('THEATER');
    } catch {
      this.removeTheater();
      this.update('UNAVAILABLE');
    }
  }

  private exitNative() {
    if (this.nativeElement !== this.wrapper) return Promise.resolve();
    const doc = this.doc as any;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    try { return Promise.resolve(exit?.call(doc)); } catch { return Promise.resolve(); }
  }

  private handleChange = () => {
    if (this.nativeElement === this.wrapper) {
      if (!this.nativeRequested) {
        void this.exitNative().catch(() => {});
        return;
      }
      this.pending = false;
      this.update('NATIVE');
    } else if (this.mode === 'NATIVE') {
      this.pending = false;
      this.nativeRequested = false;
      this.update('NONE');
    }
  };

  private handleError = (event: Event) => {
    if (this.pending && (event.target === this.wrapper || event.target === this.doc)) this.enterTheater();
  };

  private handlePopState = () => {
    if (this.historyWaiting) {
      this.historyWaiting = false;
      return;
    }
    if (this.mode === 'THEATER' && !this.ownsHistory()) this.exit(false);
    else if (this.mode === 'NATIVE') this.exit(false);
  };

  private handlePageHide = () => {
    // Do not initiate asynchronous history traversal while leaving the document.
    if (this.ownsHistory()) {
      const { bbeTheater, ...state } = this.win.history.state;
      this.win.history.replaceState(state, '');
    }
    this.exit(false);
  };

  async toggle() {
    if (this.disposed || this.historyWaiting || pendingHistoryExits.has(this.win)) return;
    if (this.mode === 'NATIVE' || this.mode === 'THEATER' || this.pending) {
      this.exit();
      return;
    }
    const element = this.wrapper as any;
    const doc = this.doc as any;
    const request = element.requestFullscreen || element.webkitRequestFullscreen || element.mozRequestFullScreen || element.msRequestFullscreen;
    const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? doc.mozFullScreenEnabled ?? doc.msFullscreenEnabled;
    if (!request || enabled === false) {
      this.enterTheater();
      return;
    }
    const id = ++this.requestId;
    this.pending = true;
    this.nativeRequested = true;
    try {
      // Call synchronously in the click's activation, before the first await.
      await request.call(element);
      if (this.disposed || id !== this.requestId) {
        // A newer controller may already own a legitimate request for this wrapper.
        if (!activeControllers.get(this.wrapper)?.nativeRequested) await this.exitNative();
        return;
      }
      if (this.nativeElement === this.wrapper) this.handleChange();
      else this.enterTheater();
    } catch {
      if (!this.disposed && id === this.requestId) this.enterTheater();
    }
  }

  exit(consumeHistory = true) {
    this.requestId++;
    this.pending = false;
    this.nativeRequested = false;
    if (this.mode === 'THEATER') this.removeTheater();
    void this.exitNative().catch(() => {});
    this.update('NONE');
    if (consumeHistory) this.consumeHistory();
    else this.historyToken = '';
  }

  dispose() {
    this.disposed = true;
    this.exit();
    this.events.forEach(event => this.doc.removeEventListener(event, this.handleChange));
    this.errors.forEach(event => this.doc.removeEventListener(event, this.handleError));
    this.win.removeEventListener('popstate', this.handlePopState);
    this.win.removeEventListener('pagehide', this.handlePageHide);
    if (activeControllers.get(this.wrapper) === this) activeControllers.delete(this.wrapper);
  }
}
