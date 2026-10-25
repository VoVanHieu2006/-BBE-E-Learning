/**
 * BBE E-Learning — Video Playback Guard Engine (P0 Anti-Seek & Continuous Playback Architecture)
 *
 * Separation of Concerns:
 * 1. displayPosition: Current time reported by YouTube player.
 * 2. serverConfirmedFurthest: Progress authoritatively acknowledged by backend. Monotonic within session.
 * 3. localContinuousPlaybackPosition: Highest legitimate position reached via continuous forward playback.
 * 4. allowedManualSeekUntil: Maximum position a learner is permitted to manually seek to.
 * 5. activeVideoSession: Strict session/lesson/video identity preventing cross-lesson pollution.
 * 6. Sequence Ordering: Drops stale or out-of-order heartbeat responses so furthest never decreases.
 */

export interface PlaybackGuardConfig {
  lessonId: string;
  videoId: string;
  viewSessionId?: string;
  duration: number;
  initialPosition?: number;
  initialFurthest?: number;
  allowFreeSeek?: boolean;
  isGuest?: boolean;
  isCompleted?: boolean;
  onSeekCorrection?: (targetTime: number, reason: string, details: Record<string, any>) => void;
  debugLog?: boolean;
}

export interface PlaybackTickResult {
  shouldSeek: boolean;
  seekTarget: number;
  reason?: string;
  currentTime: number;
  serverConfirmedFurthest: number;
  localContinuousPosition: number;
  allowedManualSeekUntil: number;
}

export interface PlaybackDebugLogEntry {
  timestamp: number;
  lessonId: string;
  videoId: string;
  viewSessionId: string;
  playerState: string;
  currentTime: number;
  serverConfirmedFurthest: number;
  localContinuousPosition: number;
  playbackRate: number;
  pendingRequestsCount: number;
  action?: string;
  seekReason?: string;
  seekSource?: string;
  rewindDuration?: number;
}

export class VideoPlaybackGuard {
  public lessonId: string;
  public videoId: string;
  public viewSessionId: string;
  public duration: number;

  public serverConfirmedFurthest: number;
  public localContinuousPosition: number;
  public allowedManualSeekUntil: number;

  public allowFreeSeek: boolean;
  public isGuest: boolean;
  public isCompleted: boolean;

  private playerState: number = -1; // -1: UNSTARTED, 1: PLAYING, 2: PAUSED, 3: BUFFERING, 0: ENDED
  private playbackRate: number = 1;

  private lastContinuousPos: number = 0;
  private lastContinuousWallTime: number = 0;

  private sequenceCounter: number = 0;
  private lastAppliedSequence: number = 0;
  private pendingRequests: Map<number, { seq: number; sentAt: number; position: number }> = new Map();

  private onSeekCorrection?: (targetTime: number, reason: string, details: Record<string, any>) => void;
  public debugLog: boolean = false;
  public logEntries: PlaybackDebugLogEntry[] = [];

  constructor(config: PlaybackGuardConfig) {
    this.lessonId = config.lessonId;
    this.videoId = config.videoId;
    this.viewSessionId = config.viewSessionId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`);
    this.duration = Math.max(0, config.duration || 0);

    const initPos = Math.max(0, config.initialPosition || 0);
    const initFurthest = Math.max(0, config.initialFurthest || 0);

    this.serverConfirmedFurthest = initFurthest;
    // localContinuousPosition starts at the highest valid initial point
    this.localContinuousPosition = Math.max(initFurthest, initPos);
    this.lastContinuousPos = initPos;
    this.lastContinuousWallTime = 0;

    this.allowFreeSeek = Boolean(config.allowFreeSeek);
    this.isGuest = Boolean(config.isGuest);
    this.isCompleted = Boolean(config.isCompleted);
    this.onSeekCorrection = config.onSeekCorrection;
    this.debugLog = Boolean(config.debugLog);

    this.allowedManualSeekUntil = this.computeAllowedManualSeekUntil();
  }

  public canSeekFreely(): boolean {
    return this.allowFreeSeek || this.isGuest || this.isCompleted;
  }

  public computeAllowedManualSeekUntil(): number {
    if (this.canSeekFreely()) {
      return this.duration > 0 ? this.duration : Infinity;
    }
    return Math.max(this.serverConfirmedFurthest, this.localContinuousPosition);
  }

  /**
   * Called when playback state changes (PLAYING, PAUSED, BUFFERING, ENDED).
   */
  public onStateChange(state: number, currentTime: number, nowMs: number = Date.now()): void {
    const prevState = this.playerState;
    this.playerState = state;

    if (state === 1) { // PLAYING
      this.lastContinuousWallTime = nowMs;
      // If we resumed from an already earned/continuous position, sync lastContinuousPos
      if (currentTime <= this.computeAllowedManualSeekUntil() + 0.5) {
        this.lastContinuousPos = currentTime;
      }
      this.recordLog('STATE_CHANGE_PLAYING', currentTime, { prevState });
    } else if (state === 3) { // BUFFERING
      // Do not advance continuous wall time while buffering
      this.lastContinuousWallTime = nowMs;
      this.recordLog('STATE_CHANGE_BUFFERING', currentTime, { prevState });
    } else if (state === 2) { // PAUSED
      this.lastContinuousWallTime = nowMs;
      this.recordLog('STATE_CHANGE_PAUSED', currentTime, { prevState });
    } else if (state === 0) { // ENDED
      this.recordLog('STATE_CHANGE_ENDED', currentTime, { prevState });
    }
  }

  public setPlaybackRate(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) {
      this.playbackRate = rate;
    }
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  /**
   * Called on every player timeupdate / UI ticker tick (e.g. every 250ms - 500ms).
   *
   * Core principle:
   * Legitimate continuous forward playback while YouTube is in PLAYING state must NEVER be
   * pulled backwards simply because a server heartbeat has not returned yet.
   */
  public onTick(currentTime: number, nowMs: number = Date.now()): PlaybackTickResult {
    this.allowedManualSeekUntil = this.computeAllowedManualSeekUntil();

    // Free seek or guests or completed videos never trigger seek guard
    if (this.canSeekFreely()) {
      this.localContinuousPosition = Math.max(this.localContinuousPosition, currentTime);
      return {
        shouldSeek: false,
        seekTarget: currentTime,
        currentTime,
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        localContinuousPosition: this.localContinuousPosition,
        allowedManualSeekUntil: this.allowedManualSeekUntil,
      };
    }

    const isPlaying = this.playerState === 1;

    // If player just started playing or we have no wall-clock baseline yet
    if (isPlaying && this.lastContinuousWallTime === 0) {
      this.lastContinuousWallTime = nowMs;
      this.lastContinuousPos = currentTime;
      this.localContinuousPosition = Math.max(this.localContinuousPosition, currentTime);
      return {
        shouldSeek: false,
        seekTarget: currentTime,
        currentTime,
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        localContinuousPosition: this.localContinuousPosition,
        allowedManualSeekUntil: this.allowedManualSeekUntil,
      };
    }

    // 1. Check if currentTime is within already authorized history
    // (e.g. user is watching or rewinding inside already confirmed/continuous territory)
    const allowedCeiling = Math.max(this.serverConfirmedFurthest, this.localContinuousPosition);
    if (currentTime <= allowedCeiling) {
      if (isPlaying) {
        this.lastContinuousPos = currentTime;
        this.lastContinuousWallTime = nowMs;
      }
      return {
        shouldSeek: false,
        seekTarget: currentTime,
        currentTime,
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        localContinuousPosition: this.localContinuousPosition,
        allowedManualSeekUntil: this.allowedManualSeekUntil,
      };
    }

    // 2. The player is advancing beyond previous ceiling.
    // Check if this advance is continuous legitimate playback:
    if (isPlaying && this.lastContinuousWallTime > 0) {
      const deltaWallSeconds = Math.max(0, (nowMs - this.lastContinuousWallTime) / 1000);
      const rate = this.playbackRate || 1;
      // Max possible forward content advance in this wall-clock tick, plus tolerance for timer jitter / audio clock skew
      const jitterTolerance = 1.5; // seconds
      const maxAllowedDelta = deltaWallSeconds * rate + jitterTolerance;
      const actualDelta = currentTime - this.lastContinuousPos;

      if (actualDelta <= maxAllowedDelta) {
        // CONTINUOUS LEGITIMATE PLAYBACK!
        // Advance localContinuousPosition smoothly with the player
        this.localContinuousPosition = Math.max(this.localContinuousPosition, currentTime);
        this.lastContinuousPos = currentTime;
        this.lastContinuousWallTime = nowMs;
        this.allowedManualSeekUntil = this.computeAllowedManualSeekUntil();

        return {
          shouldSeek: false,
          seekTarget: currentTime,
          currentTime,
          serverConfirmedFurthest: this.serverConfirmedFurthest,
          localContinuousPosition: this.localContinuousPosition,
          allowedManualSeekUntil: this.allowedManualSeekUntil,
        };
      }
    }

    // 3. If we reach here, currentTime exceeded the authorized ceiling by more than continuous playback allows.
    // Check against threshold buffer (e.g. 3 seconds) for unauthorized jump/seek cheat:
    if (currentTime > allowedCeiling + 3.0) {
      const targetTime = allowedCeiling;
      const rewindAmount = currentTime - targetTime;

      this.recordLog('SEEK_VIOLATION_TRIGGERED', currentTime, {
        targetTime,
        allowedCeiling,
        rewindAmount,
        seekReason: 'Unauthorized forward seek beyond allowed ceiling',
      });

      if (this.onSeekCorrection) {
        this.onSeekCorrection(targetTime, 'UNAUTHORIZED_FORWARD_SEEK', {
          currentTime,
          targetTime,
          allowedCeiling,
          serverConfirmedFurthest: this.serverConfirmedFurthest,
          localContinuousPosition: this.localContinuousPosition,
        });
      }

      // Reset tracker to corrected target
      this.lastContinuousPos = targetTime;
      this.lastContinuousWallTime = nowMs;

      return {
        shouldSeek: true,
        seekTarget: targetTime,
        reason: 'UNAUTHORIZED_FORWARD_SEEK',
        currentTime,
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        localContinuousPosition: this.localContinuousPosition,
        allowedManualSeekUntil: this.allowedManualSeekUntil,
      };
    }

    // Minor drift within the 3s buffer: allow playback to proceed and update timer
    if (isPlaying) {
      this.lastContinuousPos = currentTime;
      this.lastContinuousWallTime = nowMs;
    }

    return {
      shouldSeek: false,
      seekTarget: currentTime,
      currentTime,
      serverConfirmedFurthest: this.serverConfirmedFurthest,
      localContinuousPosition: this.localContinuousPosition,
      allowedManualSeekUntil: this.allowedManualSeekUntil,
    };
  }

  /**
   * Called before sending a progress / heartbeat request.
   * Returns sequence number and metadata to attach to the request.
   */
  public createProgressRequest(position: number, nowMs: number = Date.now()): {
    seq: number;
    lessonId: string;
    videoId: string;
    viewSessionId: string;
    positionSeconds: number;
    furthestWatchedPositionSeconds: number;
    playbackRate: number;
  } {
    const seq = ++this.sequenceCounter;
    // Send furthest as the max of server confirmed and local continuous position
    const furthestToSend = Math.max(this.serverConfirmedFurthest, this.localContinuousPosition, position);

    this.pendingRequests.set(seq, {
      seq,
      sentAt: nowMs,
      position,
    });

    this.recordLog('HEARTBEAT_SENT', position, {
      seq,
      furthestToSend,
    });

    return {
      seq,
      lessonId: this.lessonId,
      videoId: this.videoId,
      viewSessionId: this.viewSessionId,
      positionSeconds: position,
      furthestWatchedPositionSeconds: furthestToSend,
      playbackRate: this.playbackRate,
    };
  }

  /**
   * Called when server responds to a progress / heartbeat request.
   * Enforces sequence ordering and monotonic furthest progression.
   */
  public onServerProgressResponse(
    seq: number,
    response: any,
    nowMs: number = Date.now()
  ): {
    applied: boolean;
    reason?: string;
    serverConfirmedFurthest: number;
    isCompleted: boolean;
  } {
    this.pendingRequests.delete(seq);

    if (!response || typeof response !== 'object') {
      return {
        applied: false,
        reason: 'INVALID_RESPONSE',
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        isCompleted: this.isCompleted,
      };
    }

    // Verify session identity if provided in response
    if (response.viewSessionId && response.viewSessionId !== this.viewSessionId) {
      this.recordLog('HEARTBEAT_DROPPED_WRONG_SESSION', 0, {
        seq,
        responseSession: response.viewSessionId,
        currentSession: this.viewSessionId,
      });
      return {
        applied: false,
        reason: 'SESSION_MISMATCH',
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        isCompleted: this.isCompleted,
      };
    }

    // Drop stale / out-of-order responses
    if (seq < this.lastAppliedSequence) {
      this.recordLog('HEARTBEAT_DROPPED_OUT_OF_ORDER', 0, {
        seq,
        lastAppliedSequence: this.lastAppliedSequence,
      });
      return {
        applied: false,
        reason: 'OUT_OF_ORDER',
        serverConfirmedFurthest: this.serverConfirmedFurthest,
        isCompleted: this.isCompleted,
      };
    }

    this.lastAppliedSequence = seq;

    const serverFurthest = Number(response.furthestWatchedPositionSeconds);
    if (Number.isFinite(serverFurthest) && serverFurthest >= 0) {
      // MONOTONIC: confirmed furthest must NEVER decrease within the session
      this.serverConfirmedFurthest = Math.max(this.serverConfirmedFurthest, serverFurthest);
    }

    if (response.videoCompleted || response.completed || Number(response.progressPercentage) >= 100) {
      this.isCompleted = true;
    }

    this.allowedManualSeekUntil = this.computeAllowedManualSeekUntil();

    this.recordLog('HEARTBEAT_APPLIED', serverFurthest, {
      seq,
      updatedServerConfirmedFurthest: this.serverConfirmedFurthest,
      isCompleted: this.isCompleted,
    });

    return {
      applied: true,
      serverConfirmedFurthest: this.serverConfirmedFurthest,
      isCompleted: this.isCompleted,
    };
  }

  /**
   * Called when learner attempts to manually seek (timeline click, arrow buttons).
   * Validates target against allowedManualSeekUntil.
   */
  public clampManualSeek(targetTime: number): {
    clampedTime: number;
    wasClamped: boolean;
  } {
    if (this.canSeekFreely()) {
      const clamped = Math.max(0, Math.min(this.duration || Infinity, targetTime));
      return { clampedTime: clamped, wasClamped: clamped !== targetTime };
    }

    const maxAllowed = this.computeAllowedManualSeekUntil();
    const clamped = Math.max(0, Math.min(targetTime, maxAllowed));
    const wasClamped = clamped < targetTime;

    if (wasClamped) {
      this.recordLog('MANUAL_SEEK_CLAMPED', targetTime, {
        targetTime,
        clampedTime: clamped,
        maxAllowed,
      });
    }

    // User is moving to an authorized position: sync tracker
    this.lastContinuousPos = clamped;
    this.lastContinuousWallTime = Date.now();

    return {
      clampedTime: clamped,
      wasClamped,
    };
  }

  /**
   * Called when async props update (e.g. initialFurthest received asynchronously from API).
   */
  public updateServerFurthestFromProps(furthest: number): void {
    if (Number.isFinite(furthest) && furthest >= 0) {
      this.serverConfirmedFurthest = Math.max(this.serverConfirmedFurthest, furthest);
      this.localContinuousPosition = Math.max(this.localContinuousPosition, this.serverConfirmedFurthest);
      this.allowedManualSeekUntil = this.computeAllowedManualSeekUntil();
    }
  }

  private recordLog(action: string, currentTime: number, details: Record<string, any> = {}): void {
    if (!this.debugLog && typeof window !== 'undefined' && !(window as any).__bbeProbe) return;

    const entry: PlaybackDebugLogEntry = {
      timestamp: Date.now(),
      lessonId: this.lessonId,
      videoId: this.videoId,
      viewSessionId: this.viewSessionId,
      playerState: this.playerStateToString(this.playerState),
      currentTime,
      serverConfirmedFurthest: this.serverConfirmedFurthest,
      localContinuousPosition: this.localContinuousPosition,
      playbackRate: this.playbackRate,
      pendingRequestsCount: this.pendingRequests.size,
      action,
      ...details,
    };

    this.logEntries.push(entry);

    if (typeof console !== 'undefined' && console.debug && (this.debugLog || (typeof window !== 'undefined' && (window as any).__bbePerfLog))) {
      console.debug(`[BBE-PlaybackGuard] ${action}: ct=${currentTime.toFixed(1)}s, server=${this.serverConfirmedFurthest.toFixed(1)}s, localCont=${this.localContinuousPosition.toFixed(1)}s`, details);
    }
  }

  private playerStateToString(state: number): string {
    switch (state) {
      case 1: return 'PLAYING';
      case 2: return 'PAUSED';
      case 3: return 'BUFFERING';
      case 0: return 'ENDED';
      case -1: return 'UNSTARTED';
      default: return `UNKNOWN(${state})`;
    }
  }
}
