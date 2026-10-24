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
  lessonId: string;
  videoId: string;
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
  const [serverConfirmedFurthest, setServerConfirmedFurthest] = useState(initialFurthest);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [progressNotice, setProgressNotice] = useState('');
  const [verificationState, setVerificationState] = useState<'IDLE' | 'PLAYING' | 'ENDING' | 'VERIFYING' | 'COMPLETED' | 'RETRYABLE_ERROR'>('IDLE');

  const serverConfirmedFurthestRef = useRef(initialFurthest);
  const isVerifyingEndedRef = useRef(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const durationRef = useRef(durationSeconds || 0);
  const playbackRateRef = useRef(1);
  const isPlayingRef = useRef(false);
  const isReadyRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedFiredRef = useRef(false);
  const sendProgressRef = useRef<(ct: number, ft: number, event?: PlaybackEvent, overrideRate?: number) => Promise<any>>(async () => null);
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
    sessionIdRef.current = crypto.randomUUID();
    isVerifyingEndedRef.current = false;
    const alreadyFinished = durationSeconds > 0 && initialFurthest >= durationSeconds;
    setIsCompleted(alreadyFinished);
    setVerificationState(alreadyFinished ? 'COMPLETED' : 'IDLE');
    completedFiredRef.current = false;
    setCurrentTime(initialPosition || 0);
    setServerConfirmedFurthest(initialFurthest || 0);
    serverConfirmedFurthestRef.current = initialFurthest || 0;
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
    if (initialFurthest >= 0) {
      serverConfirmedFurthestRef.current = initialFurthest;
      setServerConfirmedFurthest(initialFurthest);
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
      setVerificationState('COMPLETED');
    }
  }, [initialPosition, initialFurthest, durationSeconds]);

  // Hẹn giờ tự ẩn thanh điều khiển (thanh tua) sau 3s khi đang phát.
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

  // Send a server-authoritative heartbeat (only for logged-in learners).
  const sendProgress = useCallback(
    async (ct: number, ft: number, event: PlaybackEvent = 'HEARTBEAT', overrideRate?: number) => {
      if (!accessToken || isGuest) return null;
      try {
        const d = durationRef.current || duration || 0;
        const actualRate = overrideRate ?? (playerRef.current?.getPlaybackRate?.() || playbackRateRef.current || 1);
        const payload: ProgressEvent = {
          lessonId,
          videoId: youtubeVideoId,
          currentTime: ct,
          duration: d,
          furthest: ft,
          viewSessionId: sessionIdRef.current,
          playbackRate: actualRate,
          event,
          playerDurationSeconds: d,
        };
        if (onProgress) return await onProgress(payload);
        const response = await apiFetch(`/api/v1/lessons/${lessonId}/progress`, {
          method: 'PATCH',
          body: JSON.stringify({
            positionSeconds: payload.currentTime,
            furthestWatchedPositionSeconds: payload.furthest,
            playerDurationSeconds: payload.playerDurationSeconds,
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
    [lessonId, youtubeVideoId, accessToken, isGuest, duration, onProgress]
  );

  useEffect(() => {
    sendProgressRef.current = sendProgress;
  }, [sendProgress]);;

  // Helper functions for robust cross-browser Fullscreen API (iOS/WebKit, Chrome, Firefox, Edge)
  const isDocFullscreen = (): boolean => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  };

  const requestDocFullscreen = async (element: HTMLElement) => {
    if (element.requestFullscreen) {
      return element.requestFullscreen();
    } else if ((element as any).webkitRequestFullscreen) {
      return (element as any).webkitRequestFullscreen();
    } else if ((element as any).mozRequestFullScreen) {
      return (element as any).mozRequestFullScreen();
    } else if ((element as any).msRequestFullscreen) {
      return (element as any).msRequestFullscreen();
    }
  };

  const exitDocFullscreen = async () => {
    if (document.exitFullscreen) {
      return document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      return (document as any).webkitExitFullscreen();
    } else if ((document as any).mozCancelFullScreen) {
      return (document as any).mozCancelFullScreen();
    } else if ((document as any).msExitFullscreen) {
      return (document as any).msExitFullscreen();
    }
  };

  // Fullscreen change listener across all browser engines
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(isDocFullscreen());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('orientationchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('orientationchange', handleFullscreenChange);
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

        const applyIframePermissions = () => {
          if (!containerRef.current) return;
          const iframe = containerRef.current.querySelector('iframe');
          if (iframe) {
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen *');
            iframe.setAttribute('allowfullscreen', 'true');
            (iframe as any).allowFullScreen = true;
            iframe.setAttribute('webkitallowfullscreen', 'true');
            iframe.setAttribute('mozallowfullscreen', 'true');
          }
        };

        playerRef.current = new window.YT.Player(mountDiv, {
          videoId: youtubeVideoId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            cc_load_policy: 0,
            fs: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: (e: any) => {
              if (unmounted) return;
              applyIframePermissions();
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
                setVerificationState('PLAYING');
                setProgressNotice('');
                setShowControls(true);
                scheduleHideControls();
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                startUiTimer();
                startHeartbeat();
                const ct = playerRef.current?.getCurrentTime?.() || 0;
                void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'PLAY');
              } else if (e.data === YT_PAUSED) {
                perfMark('pause_applied');
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                clearHideControls();
                setShowControls(true);
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                if (!isVerifyingEndedRef.current && verificationState !== 'COMPLETED') {
                  const ct = playerRef.current?.getCurrentTime?.() || 0;
                  void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'PAUSE').then(applyServerProgress);
                }
              } else if (e.data === YT_ENDED) {
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                void finishPlayback();
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
        if (playerRef.current) {
          playerRef.current.pauseVideo?.();
          playerRef.current.stopVideo?.();
          playerRef.current.destroy?.();
        }
      } catch {}
      playerRef.current = null;
    };
  }, [youtubeVideoId, retryNonce]);

  const applyServerProgress = (result: any) => {
    if (!result || typeof result !== 'object') return;
    const serverFurthest = Number(result.furthestWatchedPositionSeconds);
    if (Number.isFinite(serverFurthest) && serverFurthest >= 0) {
      serverConfirmedFurthestRef.current = serverFurthest;
      setServerConfirmedFurthest(serverFurthest);
    }
    if (result.videoCompleted || result.completed || Number(result.progressPercentage) >= 100) {
      setIsCompleted(true);
      setVerificationState('COMPLETED');
      completedFiredRef.current = true;
    }
  };

  const finishPlayback = async () => {
    if (isGuest || isVerifyingEndedRef.current || completedFiredRef.current) return;
    isVerifyingEndedRef.current = true;
    setVerificationState('VERIFYING');
    setProgressNotice('Đang kiểm tra và xác nhận hoàn thành video...');

    const d = durationRef.current || duration;
    if (!(d > 0)) {
      isVerifyingEndedRef.current = false;
      setVerificationState('RETRYABLE_ERROR');
      setProgressNotice('Chưa xác định được thời lượng video nên chưa thể ghi nhận hoàn thành.');
      return;
    }

    const actualRate = playerRef.current?.getPlaybackRate?.() || playbackRateRef.current || 1;

    let result: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await sendProgress(d, d, 'ENDED', actualRate);
        if (result?.videoCompleted || result?.completed || Number(result?.progressPercentage) >= 100) {
          applyServerProgress(result);
          setIsCompleted(true);
          setVerificationState('COMPLETED');
          setProgressNotice('');
          completedFiredRef.current = true;
          onComplete?.(result);
          try {
            playerRef.current?.seekTo?.(0, true);
            playerRef.current?.pauseVideo?.();
            setCurrentTime(0);
          } catch {}
          isVerifyingEndedRef.current = false;
          return;
        }
      } catch (err) {
        // Network or transient error, retry
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }

    isVerifyingEndedRef.current = false;
    applyServerProgress(result);
    setVerificationState('RETRYABLE_ERROR');
    setProgressNotice(
      result
        ? 'Hệ thống chưa ghi nhận đủ thời lượng xem để hoàn thành. Hãy bấm "Thử lại xác nhận" hoặc xem tiếp vài giây.'
        : 'Không thể kết nối đến máy chủ để xác nhận hoàn thành. Vui lòng bấm "Thử lại xác nhận".'
    );
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
        // ONLY update UI display position! NEVER mutate serverConfirmedFurthest here!
        setCurrentTime(ct);

        // Transition to ENDING state within 2.5 seconds of finish
        if (d > 0 && ct >= d - 2.5 && !isVerifyingEndedRef.current && !completedFiredRef.current) {
          setVerificationState((prev) => (prev === 'PLAYING' ? 'ENDING' : prev));
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
        if (isVerifyingEndedRef.current || completedFiredRef.current) return;
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'HEARTBEAT').then(applyServerProgress);
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
      if (isVerifyingEndedRef.current || completedFiredRef.current) return;
      const ct = playerRef.current?.getCurrentTime?.() || 0;
      const event: PlaybackEvent = document.visibilityState === 'hidden' ? 'PAUSE' : 'PLAY';
      if (document.visibilityState === 'hidden' && !isPlayingRef.current) return;
      void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, event).then(applyServerProgress);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isGuest]);

  // Anti-cheat seek-ahead guard for Member role (BR-03: Members CANNOT seek past furthest watched position)
  // Skipped for guests and Admin/BĐHU (allowFreeSeek === true) or already completed videos
  useEffect(() => {
    if (allowFreeSeek || isGuest || isCompleted || !isReady || videoError) return;
    const guard = setInterval(() => {
      try {
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        const maxAllowed = serverConfirmedFurthestRef.current;
        if (ct > maxAllowed + 3) {
          playerRef.current?.seekTo?.(maxAllowed, true);
          setCurrentTime(maxAllowed);
        }
      } catch {}
    }, 500);

    return () => clearInterval(guard);
  }, [isReady, videoError, allowFreeSeek, isGuest, isCompleted]);

  const displayPlaying = optimisticPlay ?? isPlaying;

  const togglePlay = () => {
    const wantPlay = !displayPlaying;
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
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * duration;

    // BR-03: Member can only seek backwards or up to serverConfirmedFurthest, UNLESS allowFreeSeek, isGuest or isCompleted
    const maxAllowed = (allowFreeSeek || isGuest || isCompleted) ? duration : serverConfirmedFurthestRef.current;
    const clampedTarget = Math.min(targetTime, maxAllowed);

    try {
      playerRef.current.seekTo(clampedTarget, true);
      setCurrentTime(clampedTarget);
    } catch {}
  };

  const setSpeed = (rate: number) => {
    if (!playerRef.current) return;
    try {
      playerRef.current.setPlaybackRate(rate);
      playbackRateRef.current = rate;
      setPlaybackRate(rate);
      const ct = playerRef.current.getCurrentTime?.() || 0;
      void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'HEARTBEAT', rate).then(applyServerProgress);
    } catch {}
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setSpeed(nextRate);
  };

  const toggleFullscreen = () => {
    if (!wrapperRef.current) return;
    if (!isDocFullscreen()) {
      requestDocFullscreen(wrapperRef.current).catch((err) => {
        console.warn('requestFullscreen error:', err);
      });
    } else {
      exitDocFullscreen().catch((err) => {
        console.warn('exitFullscreen error:', err);
      });
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
  const canSeekFree = allowFreeSeek || isGuest || isCompleted;
  const allowedSeekPercent = duration > 0 ? ((canSeekFree ? duration : serverConfirmedFurthest) / duration) * 100 : 0;

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
        const maxAllowed = (allowFreeSeek || isGuest || isCompleted) ? d : serverConfirmedFurthestRef.current;
        const targetTime = Math.min(d, ct + deltaSeconds);
        const allowedTarget = Math.min(targetTime, maxAllowed);
        if (allowFreeSeek || isGuest || isCompleted || allowedTarget > ct) {
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
  }, [canSeekFree, duration, serverConfirmedFurthest, displayPlaying, isReady]);

  return (
    <div
      ref={wrapperRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
      className={`relative w-full bg-black overflow-hidden select-none group ${
        isFullscreen
          ? 'fixed inset-0 z-[9999] w-screen h-screen !max-h-none !max-w-none rounded-none aspect-auto'
          : 'aspect-video rounded-3xl'
      }`}
    >
      {/* YouTube Player Native Container (phóng nhẹ 1.05 để đưa dải watermark/logo sát mép ngoài vùng hiển thị) */}
      <div
        ref={containerRef}
        className={`w-full h-full pointer-events-none origin-center ${
          isFullscreen ? 'scale-100 flex items-center justify-center' : 'scale-[1.05]'
        }`}
      />

      {/* Loading Skeleton: hiển thị "Đang tải video..." ngay lập tức khi khởi tạo */}
      {!isReady && !videoError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-white" aria-busy="true" aria-live="polite">
          <div className="h-10 w-10 animate-spin rounded-full border-3 border-[#2563EB] border-t-transparent" />
          <div className="space-y-1 text-center">
            <p className="text-sm font-bold text-white">Đang tải video...</p>
            <p className="text-xs text-slate-400">
              {isSlowLoading ? 'Mạng đang chậm hơn bình thường. Video sẽ tự hiển thị khi sẵn sàng.' : 'Video sẽ tự hiển thị, bạn không cần tải lại trang.'}
            </p>
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

      {/* Play/Pause Click Overlay: bao quát toàn khung nhưng để hở dải dưới cho thanh điều khiển */}
      {!videoError && isReady && (
        <div onClick={togglePlay} className="absolute inset-x-0 top-0 bottom-20 cursor-pointer z-10" />
      )}

      {/* Video tạm dừng: giữ nguyên frame đang hiển thị — chỉ phủ gradient mỏng và nhãn,
          không phủ nền đen toàn khung và không vẽ thêm biểu tượng Play to đè lên YouTube. */}
      {!videoError && isReady && !displayPlaying && (
        <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-black/20 via-transparent to-black/30">
          <span className="rounded-full bg-black/60 border border-white/20 px-3 py-1 text-[11px] font-semibold text-white/90 shadow-md backdrop-blur-sm">
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

      {/* Completion Banner (only for logged-in accounts) */}
      {!isGuest && isCompleted && (
        <div className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-xl border border-green-500/40 bg-green-900/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-sm animate-fade-in">
          <span>✓</span> Đã xem hết video (100%)
        </div>
      )}

      {/* Verification State Banner */}
      {verificationState === 'VERIFYING' && (
        <div className="absolute top-4 left-4 right-4 z-30 flex items-center gap-2.5 rounded-xl border border-blue-400/50 bg-blue-950/90 px-4 py-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm animate-fadeIn">
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
          <span>Đang kiểm tra và xác nhận hoàn thành video với hệ thống...</span>
        </div>
      )}

      {verificationState === 'RETRYABLE_ERROR' && (
        <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between gap-3 rounded-xl border border-amber-400/50 bg-amber-950/90 px-4 py-2.5 text-xs text-amber-100 shadow-lg backdrop-blur-sm animate-fadeIn">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">⚠️</span>
            <span className="truncate">{progressNotice || 'Chưa hoàn thành xác nhận video.'}</span>
          </div>
          <button
            type="button"
            onClick={() => void finishPlayback()}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg shrink-0 transition text-xs shadow-xs"
          >
            Thử lại xác nhận
          </button>
        </div>
      )}

      {progressNotice && verificationState !== 'RETRYABLE_ERROR' && !videoError && (
        <div className="absolute inset-x-4 top-4 z-20 rounded-xl border border-amber-400/40 bg-amber-950/90 px-3 py-2 text-center text-[11px] font-semibold text-amber-100 shadow-lg backdrop-blur-sm" role="status">
          {progressNotice}
        </div>
      )}

      {/* Custom Video Controls Bar */}
      {!videoError && isReady && (
        <div
          className={`absolute bottom-0 inset-x-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] z-30 transition-opacity duration-300 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] ${
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
              style={{ width: `${canSeekFree ? 100 : allowedSeekPercent}%` }}
            />
            {/* Current Watched Position */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-[#2563EB] rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-1 sm:gap-2 text-white text-xs font-semibold">
            {/* Play/Pause & Time Display */}
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={togglePlay}
                className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-xs sm:text-sm transition"
                title={displayPlaying ? 'Tạm dừng (Phím cách/Space)' : 'Phát video (Phím cách/Space)'}
              >
                {displayPlaying ? '⏸' : '▶'}
              </button>

              {/* Rewind 10s */}
              <button
                type="button"
                onClick={() => seekDelta(-10)}
                className="px-1.5 sm:px-2 py-1 shrink-0 flex items-center gap-0.5 sm:gap-1 bg-white/10 hover:bg-white/25 rounded-lg text-[10px] sm:text-[11px] font-semibold transition text-slate-200 hover:text-white"
                title="Tua lùi 10 giây (Phím mũi tên trái ←)"
              >
                <span>↺</span>
                <span>10s</span>
              </button>

              {/* Forward 10s */}
              <button
                type="button"
                disabled={!canSeekFree && currentTime + 3 >= serverConfirmedFurthest}
                onClick={() => seekDelta(10)}
                className="px-1.5 sm:px-2 py-1 shrink-0 flex items-center gap-0.5 sm:gap-1 bg-white/10 hover:bg-white/25 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-[10px] sm:text-[11px] font-semibold transition text-slate-200 hover:text-white"
                title={canSeekFree || currentTime + 3 < serverConfirmedFurthest ? 'Tua tới 10 giây (Phím mũi tên phải →)' : 'Học viên không thể tua tới đoạn chưa học'}
              >
                <span>10s</span>
                <span>↻</span>
              </button>

              <span className="text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {canSeekFree ? (
                <span className="text-[10px] text-amber-300 font-normal px-2 py-0.5 bg-amber-900/40 rounded-full hidden md:inline shrink-0">
                  Có thể tua
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 font-normal px-2 py-0.5 bg-slate-800/60 rounded-full hidden lg:inline shrink-0">
                  Không thể tua tới
                </span>
              )}
            </div>

            {/* Right Controls: Speed & Fullscreen */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Mobile Playback Speed Button (cycles speed on tap without crowding the bar) */}
              <button
                type="button"
                onClick={cyclePlaybackRate}
                className="sm:hidden px-2 py-1 rounded-lg text-xs bg-white/20 hover:bg-white/30 text-white font-bold transition shrink-0"
                title="Đổi tốc độ phát (chạm để chuyển)"
              >
                {playbackRate}x
              </button>

              {/* Desktop Playback Speed Controls */}
              <div className="hidden sm:flex items-center gap-1">
                <span className="text-slate-300 text-[11px] hidden md:inline">Tốc độ:</span>
                {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSpeed(rate)}
                    className={`px-1.5 md:px-2 py-1 rounded-lg text-xs transition ${
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
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-xs sm:text-sm transition ml-0.5 sm:ml-1 shrink-0 cursor-pointer"
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
