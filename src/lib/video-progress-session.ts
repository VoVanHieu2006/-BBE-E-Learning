import { VideoPlaybackGuard } from './video-playback-guard';

export type PlaybackEvent = 'PLAY' | 'HEARTBEAT' | 'PAUSE' | 'ENDED';
export interface VideoProgressPayload {
  lessonId: string;
  videoId: string;
  currentTime: number;
  duration: number;
  furthest: number;
  viewSessionId: string;
  playbackRate: number;
  event: PlaybackEvent;
  playerDurationSeconds: number;
}
type Reply = { ok: boolean; status: number; data?: any };
type Item = {
  payload: VideoProgressPayload;
  critical: boolean;
  resolve: (value: any) => void;
};

/** Ordered transport per viewing session; retain playback proof, coalesce redundant markers. */
export class VideoProgressSession {
  private queue: Item[] = [];
  private running = false;
  private disposed = false;
  private controller?: AbortController;
  private confirmedFloor = 0;
  private progressIdentity?: string;

  constructor(
    readonly guard: VideoPlaybackGuard,
    private transport: (payload: VideoProgressPayload, signal: AbortSignal) => Promise<Reply>,
    private isCurrent: () => boolean,
    private accepted: (data: any, payload: VideoProgressPayload) => void,
    private timeoutMs = 15000,
  ) {}

  send(position: number, duration: number, rate: number, event: PlaybackEvent = 'HEARTBEAT', critical = event !== 'HEARTBEAT'): Promise<any> {
    if (this.disposed) return Promise.resolve(null);
    // Capture the actual position/rate now, before seekTo/setPlaybackRate changes it.
    const payload: VideoProgressPayload = {
      lessonId: this.guard.lessonId, videoId: this.guard.videoId,
      viewSessionId: this.guard.viewSessionId,
      currentTime: position, duration, playerDurationSeconds: duration,
      furthest: Math.max(this.guard.serverConfirmedFurthest, this.guard.localContinuousPosition),
      playbackRate: rate, event,
    };
    return new Promise(resolve => {
      const tail = this.queue.at(-1);
      if (!critical && tail && !tail.critical && tail.payload.playbackRate === rate &&
        tail.payload.currentTime <= this.confirmedFloor && position <= this.confirmedFloor) {
        this.queue.pop()!.resolve(null);
      }
      this.queue.push({ payload, critical, resolve });
      this.compactHistoryMarkers();
      void this.drain();
    });
  }

  private compactHistoryMarkers(): void {
    // Keep the actual pre-seek checkpoint, in order. Below that retained proof,
    // intermediate rewind/PLAY/rate markers cannot advance server progress;
    // only their final position/state is needed. Sending all of them would
    // repeatedly reset the backend clock long after playback has moved on.
    const proof = this.confirmedFloor;
    const kept: Item[] = [];
    let redundantTail = false;
    const discardTail = () => {
      if (redundantTail) kept.pop()!.resolve(null);
      redundantTail = false;
    };
    for (const item of this.queue) {
      if (item.payload.event === 'ENDED') {
        kept.push(item);
        redundantTail = false;
      } else if (item.payload.currentTime <= proof) {
        discardTail();
        kept.push(item);
        redundantTail = true;
      } else {
        kept.push(item);
        redundantTail = false;
      }
    }
    this.queue = kept;
  }

  private confirmProgress(data: any): void {
    const context = data?.progressContext;
    const identity = context ? `${context.learningCycleId || ''}:${context.competitionMonthId || ''}` : 'compat';
    if (this.progressIdentity !== identity) this.confirmedFloor = 0;
    this.progressIdentity = identity;
    const training = Number(data?.furthestWatchedPositionSeconds);
    let confirmed = Number.isFinite(training) ? Math.max(0, training) : 0;
    if (context?.monthlyReplayRequired) {
      const replay = data?.replay;
      const matches = replay?.learningCycleId === context.learningCycleId && replay?.competitionMonthId === context.competitionMonthId;
      const replaySeconds = Number(replay?.watchedSeconds);
      confirmed = matches && Number.isFinite(replaySeconds) ? Math.min(confirmed, Math.max(0, replaySeconds)) : 0;
    }
    this.confirmedFloor = confirmed;
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.queue.splice(0).forEach(item => item.resolve(null));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const item = this.queue.shift()!;
        const { seq } = this.guard.createProgressRequest(item.payload.currentTime);
        const controller = new AbortController();
        this.controller = controller;
        let status = 0;
        let reason = 'NETWORK_ERROR';
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: () => void = () => {};
        try {
          const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(new Error('ABORTED'));
            controller.signal.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => controller.abort(), this.timeoutMs);
          });
          const response = await Promise.race([this.transport(item.payload, controller.signal), cancelled]);
          status = response.status;
          if (this.disposed || !this.isCurrent()) {
            reason = 'STALE_SESSION';
            item.resolve(null);
          } else if (!response.ok) {
            reason = 'HTTP_ERROR';
            item.resolve(null);
          } else {
            const result = this.guard.onServerProgressResponse(seq, response.data);
            reason = result.reason || 'APPLIED';
            if (result.applied) {
              this.confirmProgress(response.data);
              this.compactHistoryMarkers();
              this.accepted(response.data, item.payload);
            }
            item.resolve(result.applied ? response.data : null);
          }
        } catch {
          reason = controller.signal.aborted ? 'ABORTED_OR_TIMEOUT' : 'NETWORK_ERROR';
          item.resolve(null);
        } finally {
          if (timer) clearTimeout(timer);
          controller.signal.removeEventListener('abort', abort);
          this.guard.finishProgressRequest(seq, status, reason);
          this.controller = undefined;
        }
      }
    } finally { this.running = false; }
  }
}
