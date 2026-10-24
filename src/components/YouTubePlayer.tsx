'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api/client';

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: any) => any;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
        BUFFERING: number;
        CUED: number;
        UNSTARTED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
    _ytApiLoading?: boolean;
    _ytCallbacks?: Array<() => void>;
  }
}

const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_ENDED = 0;
const YT_BUFFERING = 3;

type PlaybackEvent = 'PLAY' | 'HEARTBEAT' | 'PAUSE' | 'ENDED'

interface ProgressEvent {
  currentTime: number;
  duration: number;
  furthest: number;
  viewSessionId: string;
  playbackRate: number;
  event: PlaybackEvent;
  playerDurationSeconds?: number;
}

interface Props {
  youtubeVideoId: string;
  lessonId: string;
  accessToken?: string;
  allowFreeSeek?: boolean;
  initialPosition?: number;
  initialFurthest?: number;
  durationSeconds?: number;
  onProgress?: (p: ProgressEvent) => void | Promise<any>;
  onComplete?: (result?: any) => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Optional instrumentation for the playback responsiveness benchmark. Enabled
// by appending ?probe=1 (persisted, so in-tab navigation keeps sampling).
function perfMark(name: string) {
  if (typeof window === 'undefined') return;
  try {
    if (!window.__bbeProbe && new URLSearchParams(window.location.search).get('probe') !== '1') return;
    window.__bbeProbe = true;
    const list = ((window as any).__bbePerf ||= []);
    const entry = { name, at: performance.now() };
    list.push(entry);
    if (window.__bbePerfLog !== false) console.debug('[bbe-perf]', name, entry.at.toFixed(1));
  } catch {}
}

declare global {
  interface Window {
    __bbeProbe?: boolean;
    __bbePerf?: Array<{ name: string; at: number }>;
    __bbePerfLog?: boolean;
  }
}

export default function YouTubePlayer({
  youtubeVideoId,
  lessonId,
  accessToken,
  allowFreeSeek = false,
  initialPosition = 0,
  initialFurthest = 0,
  durationSeconds = 0,
  onProgress,
  onComplete,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const pendingPlayRef = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [furthest, setFurthest] = useState(initialFurthest);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [progressNotice, setProgressNotice] = useState('');

  const furthestRef = useRef(initialFurthest);
  const durationRef = useRef(durationSeconds || 0);
  const playbackRateRef = useRef(1);
  const isPlayingRef = useRef(false);
  const isReadyRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedFiredRef = useRef(false);
  const endedSentRef = useRef(false);
  const sendProgressRef = useRef<(ct: number, ft: number, event?: PlaybackEvent) => Promise<any>>(async () => null);
  // Optimistic play/pause intent so the first click reacts instantly. Cleared
  // the moment YouTube confirms any state change.
  const [optimisticPlay, setOptimisticPlay] = useState<boolean | null>(null);

  const clearPauseRetry = () => {
    if (pauseRetryRef.current) {
      clearInterval(pauseRetryRef.current);
      pauseRetryRef.current = null;
    }
  };

  // YouTube swallows pauseVideo() while it is buffering, so accept the click
  // immediately and keep asking the player until it really pauses.
  const reliablePause = () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.pauseVideo();
    } catch {}
    clearPauseRetry();
    if (player.getPlayerState?.() === YT_PAUSED) return;
    let attempts = 0;
    pauseRetryRef.current = setInterval(() => {
      attempts += 1;
      try {
        if (playerRef.current) playerRef.current.pauseVideo();
        if (playerRef.current?.getPlayerState?.() === YT_PAUSED || attempts > 4) clearPauseRetry();
      } catch {
        clearPauseRetry();
      }
    }, 150);
  };

  // Reset all video progress and completion flags immediately when lesson or video changes
  useEffect(() => {
    const alreadyFinished = durationSeconds > 0 && initialFurthest >= durationSeconds;
    setIsCompleted(alreadyFinished);
    completedFiredRef.current = false;
    endedSentRef.current = false;
    setCurrentTime(initialPosition || 0);
    setFurthest(initialFurthest || 0);
    furthestRef.current = initialFurthest || 0;
    durationRef.current = durationSeconds || 0;
    setDuration(durationSeconds || 0);
    setVideoError('');
    setProgressNotice('');
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsBuffering(false);
    setOptimisticPlay(null);
    clearPauseRetry();
    setPlaybackRate(1);
    playbackRateRef.current = 1;
  }, [lessonId, youtubeVideoId]);

  // Update furthest and currentTime when props arrive asynchronously after mount (fixes F5 loss)
  useEffect(() => {
    if (initialFurthest > 0 && initialFurthest > furthestRef.current) {
      furthestRef.current = initialFurthest;
      setFurthest(initialFurthest);
    }
    if (initialPosition > 0 && currentTime === 0) {
      setCurrentTime(initialPosition);
      if (playerRef.current?.seekTo) {
        try {
          playerRef.current.seekTo(initialPosition, true);
        } catch {}
      }
    }
    if (durationSeconds > 0 && initialFurthest >= durationSeconds) {
      setIsCompleted(true);
    }
  }, [initialPosition, initialFurthest, durationSeconds]);

  // Hẹn giờ tự ẩn thanh điều khiển (thanh tua) sau 3s khi đang phát.
  // Được gọi từ handleMouseMove VÀ từ onStateChange(YT_PLAYING) —
  // tránh việc thanh tua kẹt hiện mãi khi user bấm play mà không rê chuột sau đó.
  const scheduleHideControls = () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  const clearHideControls = () => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  };

  const isGuest = !accessToken;
  const viewSessionRef = useRef('');

  // Send a server-authoritative heartbeat (only for logged-in learners).
  // apiFetch handles 401 refresh so a 15-minute access token does not silently
  // drop watch progress. The learning page owns the request and returns the
  // backend-confirmed completion/reward payload.
  const sendProgress = useCallback(
    async (ct: number, ft: number, event: PlaybackEvent = 'HEARTBEAT') => {
      if (!accessToken || isGuest) return null;
      try {
        const d = durationRef.current || duration || 0;
        const safeFurthest = ft === 0 && furthestRef.current > 0 ? furthestRef.current : ft;

        if (!viewSessionRef.current) viewSessionRef.current = crypto.randomUUID();
        const payload: ProgressEvent = {
          // Fractions are intentional: the server clamps everything and strict
          // integer rounding here used to strand viewers at 99.x%.
          currentTime: ct,
          duration: d,
          furthest: Math.max(ct, safeFurthest),
          viewSessionId: viewSessionRef.current,
          playbackRate: playbackRateRef.current,
          event,
          playerDurationSeconds: d,
        };
        if (onProgress) return await onProgress(payload);
        const response = await apiFetch(`/api/v1/lessons/${lessonId}/progress`, {
          method: 'PATCH',
          body: JSON.stringify({
            positionSeconds: payload.currentTime,
            furthestWatchedPositionSeconds: payload.furthest,
            playbackRate: payload.playbackRate,
            event: payload.event,
            viewSessionId: payload.viewSessionId,
          }),
        });
        return response.ok ? response.data : null;
      } catch {
        return null;
      }
    },
    [lessonId, accessToken, isGuest, duration, onProgress]
  )

  useEffect(() => {
    sendProgressRef.current = sendProgress;
  }, [sendProgress]);;

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Robust YouTube IFrame Player API loader and mounting. The effect is
  // intentionally keyed by video and retryNonce: changing auth or progress does
  // not recreate the player (which would lose the current playback position).
  useEffect(() => {
    let unmounted = false;
    let poller: ReturnType<typeof setInterval> | null = null;
    let initTimeout: ReturnType<typeof setTimeout> | null = null;
    let slowTimeout: ReturnType<typeof setTimeout> | null = null;
    let initialized = false;

    setIsReady(false);
    setVideoError('');
    setIsSlowLoading(false);

    slowTimeout = setTimeout(() => {
      if (!unmounted && !isReadyRef.current) setIsSlowLoading(true);
    }, 7000);

    const fail = (message: string) => {
      if (unmounted) return;
      setVideoError(message);
      setIsBuffering(false);
      setIsSlowLoading(false);
      stopHeartbeat();
      stopUiTimer();
    };

    const initPlayer = () => {
      if (unmounted || initialized || !containerRef.current || !window.YT?.Player) return;
      initialized = true;
      try {
        if (playerRef.current) {
          try {
            playerRef.current.destroy?.();
          } catch {}
          playerRef.current = null;
        }

        containerRef.current.innerHTML = '';
        const mountDiv = document.createElement('div');
        mountDiv.style.width = '100%';
        mountDiv.style.height = '100%';
        containerRef.current.appendChild(mountDiv);

        playerRef.current = new window.YT.Player(mountDiv, {
          videoId: youtubeVideoId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            cc_load_policy: 0,
            fs: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: (e: any) => {
              if (unmounted) return;
              if (slowTimeout) clearTimeout(slowTimeout);
              setIsReady(true);
              isReadyRef.current = true;
              setIsSlowLoading(false);
              perfMark('ready');
              // Tắt phụ đề mặc định (cc_load_policy=0 không đủ với một số video)
              try {
                e.target.unloadModule?.('captions');
                e.target.setOption?.('captions', 'track', {});
              } catch {}
              const d = e.target.getDuration() || durationSeconds;
              if (d > 0) {
                setDuration(d);
                durationRef.current = d;
              }
              if (initialPosition > 0) {
                e.target.seekTo(initialPosition, true);
              }
              if (pendingPlayRef.current) {
                pendingPlayRef.current = false;
                try {
                  e.target.playVideo();
                } catch {}
              }
            },
            onStateChange: (e: any) => {
              if (unmounted) return;
              setOptimisticPlay(null);
              if (e.data === YT_BUFFERING) {
                setIsBuffering(true);
              } else if (e.data === YT_PLAYING) {
                perfMark('playing');
                setIsBuffering(false);
                setIsPlaying(true);
                isPlayingRef.current = true;
                // A new explicit play may be the learner's retry after the
                // server could not confirm the previous ENDED event.
                endedSentRef.current = false;
                setProgressNotice('');
                setShowControls(true);
                scheduleHideControls();
                // Đảm bảo phụ đề không tự bật khi phát
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                startUiTimer();
                startHeartbeat();
                // Establish a server timestamp at playback start. This allows
                // elapsed-time validation without granting a free first jump.
                const ct = playerRef.current?.getCurrentTime?.() || 0;
                void sendProgressRef.current(ct, Math.max(furthestRef.current, ct), 'PLAY');
              } else if (e.data === YT_PAUSED) {
                perfMark('pause_applied');
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                clearHideControls();
                setShowControls(true);
                // Phòng phụ đề bật lại khi tạm dừng
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                const ct = playerRef.current?.getCurrentTime?.() || 0;
                void sendProgressRef.current(ct, furthestRef.current, 'PAUSE');
              } else if (e.data === YT_ENDED) {
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                void finishPlayback();
                // Quay về đầu thay vì hiện màn hình đề xuất video của YouTube
                try {
                  playerRef.current?.seekTo?.(0, true);
                  playerRef.current?.pauseVideo?.();
                } catch {}
                setCurrentTime(0);
              }
            },
            onError: (e: any) => {
              if (unmounted) return;
              let msg = 'Không thể tải video YouTube. Vui lòng thử lại.';
              if (e.data === 100 || e.data === 101 || e.data === 150) {
                msg = 'Video này ở chế độ riêng tư hoặc không cho phép phát lại ngoài YouTube.';
              } else if (e.data === 2) {
                msg = 'ID video YouTube không hợp lệ.';
              }
              fail(msg);
            },
          },
        });
      } catch (err) {
        console.error('[YT PLAYER INIT ERROR]:', err);
        fail('Không thể khởi tạo trình phát video. Vui lòng thử lại.');
      }
    };

    if (window.YT && typeof window.YT.Player === 'function') {
      setTimeout(initPlayer, 50);
    } else {
      if (!window._ytCallbacks) {
        window._ytCallbacks = [];
      }
      window._ytCallbacks.push(initPlayer);

      if (!window._ytApiLoading) {
        window._ytApiLoading = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        window.onYouTubeIframeAPIReady = () => {
          if (window._ytCallbacks) {
            window._ytCallbacks.forEach((cb) => {
              try {
                cb();
              } catch {}
            });
            window._ytCallbacks = [];
          }
        };
        tag.onerror = () => fail('Không thể kết nối tới YouTube. Vui lòng kiểm tra mạng và thử lại.');
        document.head.appendChild(tag);
      }

      poller = setInterval(() => {
        if (window.YT && typeof window.YT.Player === 'function') {
          if (poller) clearInterval(poller);
          initPlayer();
        }
      }, 150);
    }

    initTimeout = setTimeout(() => {
      if (!unmounted && !isReadyRef.current && !initialized) {
        fail('YouTube phản hồi quá lâu. Vui lòng thử lại.');
      }
    }, 15000);

    return () => {
      unmounted = true;
      isReadyRef.current = false;
      if (poller) clearInterval(poller);
      if (initTimeout) clearTimeout(initTimeout);
      if (slowTimeout) clearTimeout(slowTimeout);
      stopHeartbeat();
      stopUiTimer();
      clearHideControls();
      clearPauseRetry();
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
    };
  }, [youtubeVideoId, retryNonce]);

  const applyServerProgress = (result: any) => {
    if (!result || typeof result !== 'object') return;
    const serverFurthest = Number(result.furthestWatchedPositionSeconds);
    if (!Number.isFinite(serverFurthest) || serverFurthest < 0) return;
    // The client may be a fraction of a second ahead while a heartbeat is in
    // flight. Keeping a small lead avoids a visible snap-back during 2x playback,
    // but the local seek lock can never be more than 3s ahead of the server.
    if (serverFurthest + 3 < furthestRef.current) {
      furthestRef.current = serverFurthest + 3;
      setFurthest(furthestRef.current);
    }
    if (result.videoCompleted) {
      setIsCompleted(true);
      completedFiredRef.current = true;
    }
  };

  const finishPlayback = async () => {
    if (isGuest || endedSentRef.current) return;
    endedSentRef.current = true;
    const d = durationRef.current || duration;
    if (!(d > 0)) {
      setProgressNotice('Chưa xác định được thời lượng video nên chưa thể ghi nhận hoàn thành.');
      return;
    }
    furthestRef.current = Math.max(furthestRef.current, d);
    setFurthest(furthestRef.current);
    const result = await sendProgressRef.current(d, d, 'ENDED');
    applyServerProgress(result);
    if (result?.videoCompleted || result?.completed || Number(result?.progressPercentage) >= 100) {
      setIsCompleted(true);
      completedFiredRef.current = true;
      onComplete?.(result);
    } else {
      // Keep the guard closed to avoid a 500ms retry loop. Pressing play again
      // resets it, so the learner has an explicit, throttled retry path.
      setProgressNotice(
        result
          ? 'Hệ thống chưa xác nhận đủ thời lượng video. Hãy phát tiếp vài giây để tiến độ được đồng bộ.'
          : 'Chưa gửi được xác nhận kết thúc video. Kiểm tra kết nối mạng, phát lại vài giây rồi thử lại.',
      );
    }
  };

  const startUiTimer = () => {
    stopUiTimer();
    uiTimerRef.current = setInterval(() => {
      if (!playerRef.current) return;
      try {
        const ct = playerRef.current.getCurrentTime?.() || 0;
        const d = playerRef.current.getDuration?.() || durationRef.current || duration;
        if (d > 0) {
          durationRef.current = d;
          setDuration(d);
        }
        const newFurthest = Math.max(furthestRef.current, Math.min(ct, d || ct));
        furthestRef.current = newFurthest;
        setCurrentTime(ct);
        setFurthest(newFurthest);

        // Completion is never granted here. The ENDED heartbeat must be
        // confirmed by the backend before the completion callback runs.
        if (!isGuest && !endedSentRef.current && d > 0 && newFurthest >= d - 0.35) {
          void finishPlayback();
        }
      } catch {}
    }, 500);
  };

  const stopUiTimer = () => {
    if (uiTimerRef.current) {
      clearInterval(uiTimerRef.current);
      uiTimerRef.current = null;
    }
  };

  const startHeartbeat = () => {
    if (isGuest) return;
    stopHeartbeat();
    const d = durationRef.current || duration;
    const intervalMs = d > 0 && d < 30 ? 3000 : 10000;

    heartbeatRef.current = setInterval(() => {
      try {
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        void sendProgressRef.current(ct, furthestRef.current, 'HEARTBEAT').then(applyServerProgress);
      } catch {}
    }, intervalMs);
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // Persist the latest position when the tab is hidden, and immediately
  // re-establish a verified heartbeat when it becomes visible again.
  useEffect(() => {
    if (isGuest) return;
    const handleVisibility = () => {
      const ct = playerRef.current?.getCurrentTime?.() || 0;
      const event: PlaybackEvent = document.visibilityState === 'hidden' ? 'PAUSE' : 'PLAY';
      if (document.visibilityState === 'hidden' && !isPlayingRef.current) return;
      void sendProgressRef.current(ct, furthestRef.current, event).then(applyServerProgress);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isGuest]);

  // Anti-cheat seek-ahead guard for Member role (BR-03: Members CANNOT seek past furthest watched position)
  // Skipped for guests and Admin/BĐHU (allowFreeSeek === true)
  useEffect(() => {
    if (allowFreeSeek || isGuest || !isReady || videoError) return;
    const guard = setInterval(() => {
      try {
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        // BR-03: Client seek-lock: buffer 5s (tránh kích hoạt YouTube OSD/logo khi xem tốc độ 2x)
        if (ct > furthestRef.current + 5) {
          playerRef.current?.seekTo?.(furthestRef.current, true);
          setCurrentTime(furthestRef.current);
        }
      } catch {}
    }, 500);

    return () => clearInterval(guard);
  }, [isReady, videoError, allowFreeSeek, isGuest]);

  const displayPlaying = optimisticPlay ?? isPlaying;

  const togglePlay = () => {
    const wantPlay = !displayPlaying;
    // Instant visual feedback — YouTube's state event only confirms later.
    setOptimisticPlay(wantPlay);
    if (!playerRef.current || !isReady) {
      pendingPlayRef.current = wantPlay;
      return;
    }
    try {
      if (wantPlay) {
        perfMark('click_play');
        playerRef.current.playVideo();
      } else {
        perfMark('click_pause');
        reliablePause();
      }
    } catch {
      pendingPlayRef.current = wantPlay;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const targetTime = pos * duration;

    // BR-03: Member can only seek backwards or up to furthest watched position, UNLESS allowFreeSeek or isGuest
    if (allowFreeSeek || isGuest || targetTime <= furthestRef.current) {
      try {
        playerRef.current.seekTo(targetTime, true);
        setCurrentTime(targetTime);
      } catch {}
    }
  };

  const setSpeed = (rate: number) => {
    if (!playerRef.current) return;
    try {
      playerRef.current.setPlaybackRate(rate);
      playbackRateRef.current = rate;
      setPlaybackRate(rate);
      // Send an immediate heartbeat so short watches at a new rate are not
      // evaluated with the previous rate.
      const ct = playerRef.current.getCurrentTime?.() || 0;
      void sendProgressRef.current(ct, furthestRef.current, 'HEARTBEAT').then(applyServerProgress);
    } catch {}
  };

  const toggleFullscreen = () => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (displayPlaying) {
      scheduleHideControls();
    } else {
      clearHideControls();
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const furthestPercent = duration > 0 ? (furthest / duration) * 100 : 0;
  const canSeekFree = allowFreeSeek || isGuest;

  const seekDelta = (deltaSeconds: number) => {
    if (!playerRef.current) return;
    try {
      const ct = playerRef.current.getCurrentTime?.() || 0;
      const d = durationRef.current || duration || Infinity;
      if (deltaSeconds < 0) {
        const targetTime = Math.max(0, ct + deltaSeconds);
        playerRef.current.seekTo(targetTime, true);
        setCurrentTime(targetTime);
        setShowControls(true);
        scheduleHideControls();
      } else {
        const maxAllowed = canSeekFree ? d : furthestRef.current;
        const targetTime = Math.min(d, ct + deltaSeconds);
        const allowedTarget = Math.min(targetTime, maxAllowed);
        if (canSeekFree || allowedTarget > ct) {
          playerRef.current.seekTo(allowedTarget, true);
          setCurrentTime(allowedTarget);
          setShowControls(true);
          scheduleHideControls();
        }
      }
    } catch {}
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekDelta(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekDelta(10);
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSeekFree, duration, furthest, displayPlaying, isReady]);

  return (
    <div
      ref={wrapperRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
      className={`relative w-full aspect-video bg-black overflow-hidden select-none group ${
        isFullscreen ? 'rounded-none max-h-screen' : 'rounded-3xl'
      }`}
    >
      {/* YouTube Player Native Container (phóng nhẹ 1.05 để đưa dải watermark/logo sát mép ngoài vùng hiển thị) */}
      <div ref={containerRef} className="w-full h-full pointer-events-none scale-[1.05] origin-center" />

      {/* Loading Skeleton: shown until the YouTube player is actually ready. */}
      {!isReady && !videoError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-white" aria-busy="true" aria-live="polite">
          <div className="relative grid h-20 w-28 place-items-center rounded-2xl border border-white/10 bg-white/5">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#2563EB] border-t-transparent" />
            <span className="absolute bottom-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">YouTube</span>
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-bold text-white">Đang khởi tạo trình phát video…</p>
            <p className="text-xs text-slate-400">
              {isSlowLoading ? 'Mạng đang chậm hơn bình thường. Video sẽ tự hiển thị khi sẵn sàng.' : 'Video sẽ tự hiển thị, bạn không cần tải lại trang.'}
            </p>
          </div>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#2563EB]" />
          </div>
        </div>
      )}

      {videoError && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 p-6 text-center text-white">
          <div className="mb-3 text-4xl">⚠️</div>
          <h4 className="mb-1 text-lg font-bold">Không thể phát video</h4>
          <p className="mb-4 max-w-md text-xs leading-relaxed text-slate-300">{videoError}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsReady(false);
                setVideoError('');
                setProgressNotice('');
                setRetryNonce((value) => value + 1);
              }}
              className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1d4ed8]"
            >
              ↻ Thử lại
            </button>
            <a
              href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              Xem trên YouTube →
            </a>
          </div>
        </div>
      )}

      {/* Play/Pause Click Overlay (no redundant central logo over YouTube thumbnail) */}
      {!videoError && isReady && (
        <div onClick={togglePlay} className="absolute inset-0 cursor-pointer z-10" />
      )}

      {/* Video tạm dừng: giữ nguyên frame đang hiển thị — chỉ phủ gradient mỏng và nhãn,
          không phủ nền đen toàn khung (người học phải thấy khung cảnh đang dừng). */}
      {!videoError && isReady && !displayPlaying && (
        <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-black/25 via-black/10 to-black/25">
          <span className="grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-black/45 text-xl text-white shadow-xl backdrop-blur-sm">
            ▶
          </span>
          <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
            Bấm để phát
          </span>
        </div>
      )}

      {/* Buffering: chỉ thanh tiến trình mảnh trên cùng —
          không vẽ spinner riêng đè lên lớp buffering của YouTube. */}
      {!videoError && isReady && isBuffering && isPlaying && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[12] h-[3px] overflow-hidden">
          <div className="bbe-buffer-bar h-full w-1/3 rounded-full bg-[#2563EB]" />
        </div>
      )}

      {/* Completion Banner (only for logged-in accounts). It refers to the
          video only; lesson completion additionally requires the quiz. */}
      {!isGuest && isCompleted && (
        <div className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-xl border border-green-500/40 bg-green-900/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-sm animate-fade-in">
          <span>✓</span> Đã xem hết video (100%)
        </div>
      )}

      {progressNotice && !videoError && (
        <div className="absolute inset-x-4 top-4 z-20 rounded-xl border border-amber-400/40 bg-amber-950/90 px-3 py-2 text-center text-[11px] font-semibold text-amber-100 shadow-lg backdrop-blur-sm" role="status">
          {progressNotice}
        </div>
      )}

      {/* Custom Video Controls Bar */}
      {!videoError && isReady && (
        <div
          className={`absolute bottom-0 inset-x-0 p-4 z-30 transition-opacity duration-300 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
            showControls || !displayPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Bar */}
          <div
            onClick={handleSeek}
            className="relative h-2 bg-white/20 rounded-full cursor-pointer mb-3 group/timeline overflow-hidden"
            title={canSeekFree ? 'Bấm để tua video' : 'Chỉ có thể tua trong đoạn đã xem'}
          >
            {/* Furthest Watched Bar (Allowed Seek Range for Members) */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-white/40 rounded-full"
              style={{ width: `${canSeekFree ? 100 : furthestPercent}%` }}
            />
            {/* Current Watched Position */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-[#2563EB] rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-white text-xs font-semibold">
            {/* Play/Pause & Time Display */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-sm transition"
                title={displayPlaying ? 'Tạm dừng (Phím cách/Space)' : 'Phát video (Phím cách/Space)'}
              >
                {displayPlaying ? '⏸' : '▶'}
              </button>

              {/* Rewind 10s */}
              <button
                onClick={() => seekDelta(-10)}
                className="px-2 py-1 flex items-center gap-1 bg-white/10 hover:bg-white/25 rounded-lg text-[11px] font-semibold transition text-slate-200 hover:text-white"
                title="Tua lùi 10 giây (Phím mũi tên trái ←)"
              >
                <span>↺</span>
                <span>10s</span>
              </button>

              {/* Forward 10s */}
              <button
                disabled={!canSeekFree && currentTime + 5 >= furthest}
                onClick={() => seekDelta(10)}
                className="px-2 py-1 flex items-center gap-1 bg-white/10 hover:bg-white/25 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-[11px] font-semibold transition text-slate-200 hover:text-white"
                title={canSeekFree || currentTime + 5 < furthest ? 'Tua tới 10 giây (Phím mũi tên phải →)' : 'Học viên không thể tua tới đoạn chưa học'}
              >
                <span>10s</span>
                <span>↻</span>
              </button>

              <span className="text-xs">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {canSeekFree ? (
                <span className="text-[10px] text-amber-300 font-normal px-2 py-0.5 bg-amber-900/40 rounded-full">
                  Có thể tua
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 font-normal px-2 py-0.5 bg-slate-800/60 rounded-full hidden sm:inline">
                  Không thể tua tới
                </span>
              )}
            </div>

            {/* Right Controls: Speed & Fullscreen */}
            <div className="flex items-center gap-2">
              {/* Playback Speed Controls */}
              <div className="flex items-center gap-1">
                <span className="text-slate-300 text-[11px] hidden sm:inline">Tốc độ:</span>
                {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => setSpeed(rate)}
                    className={`px-2 py-1 rounded-lg text-xs transition ${
                      playbackRate === rate
                        ? 'bg-[#2563EB] text-white font-bold'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-sm transition ml-1"
                title={isFullscreen ? 'Thu nhỏ màn hình (Esc)' : 'Toàn màn hình (Fullscreen)'}
              >
                {isFullscreen ? '🗗' : '⛶'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
