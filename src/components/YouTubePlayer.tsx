'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api/client';
import { VideoPlaybackGuard } from '@/lib/video-playback-guard';
import { VideoControls } from '@/lib/video-controls';
import { VideoFullscreen, type FullscreenMode } from '@/lib/video-fullscreen';
import { VideoProgressSession, type PlaybackEvent, type VideoProgressPayload } from '@/lib/video-progress-session';
import { isServerVideoCompleted } from '@/lib/video-progress-rules';
import { isStandaloneMode } from '@/lib/pwa';

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

interface Props {
  youtubeVideoId: string;
  videoId?: string;
  lessonId: string;
  accessToken?: string;
  allowFreeSeek?: boolean;
  initialPosition?: number;
  initialFurthest?: number;
  durationSeconds?: number;
  onProgressApplied?: (data: any, p: VideoProgressPayload) => void;
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
  videoId = youtubeVideoId,
  lessonId,
  accessToken,
  allowFreeSeek = false,
  initialPosition = 0,
  initialFurthest = 0,
  durationSeconds = 0,
  onProgressApplied,
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
  const [controls] = useState(() => new VideoControls(setShowControls));
  const [isCompleted, setIsCompleted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState<FullscreenMode>('NONE');
  const [videoError, setVideoError] = useState('');
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [progressNotice, setProgressNotice] = useState('');
  const [verificationState, setVerificationState] = useState<'IDLE' | 'PLAYING' | 'ENDING' | 'VERIFYING' | 'COMPLETED' | 'RETRYABLE_ERROR'>('IDLE');
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);

  const serverConfirmedFurthestRef = useRef(initialFurthest);
  const isVerifyingEndedRef = useRef(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const durationRef = useRef(durationSeconds || 0);
  const playbackRateRef = useRef(1);
  const isPlayingRef = useRef(false);
  const isReadyRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedFiredRef = useRef(false);
  const sendProgressRef = useRef<(ct: number, ft: number, event?: PlaybackEvent, overrideRate?: number, critical?: boolean) => Promise<any>>(async () => null);
  const progressSessionRef = useRef<VideoProgressSession | null>(null);
  const acceptedProgressRef = useRef<(data: any, payload: VideoProgressPayload) => void>(() => {});
  const accessTokenRef = useRef(accessToken);
  const playerStateRef = useRef(-1);
  const finishPlaybackRef = useRef<() => Promise<void>>(async () => {});
  accessTokenRef.current = accessToken;

  useEffect(() => {
    setIsStandaloneApp(isStandaloneMode());
  }, []);

  // Mobile Tiered Fullscreen management (Native Fullscreen + Viewport Theater Mode fallback for iPhone/WebKit)
  const fullscreenModeRef = useRef<FullscreenMode>('NONE');
  const fullscreenControllerRef = useRef<VideoFullscreen | null>(null);

  // VideoPlaybackGuard engine separating legitimate continuous playback from unauthorized seek
  const guardRef = useRef<VideoPlaybackGuard>(
    new VideoPlaybackGuard({
      lessonId,
      videoId,
      duration: durationSeconds || 0,
      initialPosition,
      initialFurthest,
      allowFreeSeek,
      isGuest: !accessToken,
      isCompleted: durationSeconds > 0 && initialFurthest >= durationSeconds,
      onSeekCorrection: (targetTime) => {
        try {
          playerRef.current?.seekTo?.(targetTime, true);
          setCurrentTime(targetTime);
        } catch {}
      },
    })
  );

  // Optimistic play/pause intent so the first click reacts instantly. Cleared
  const [optimisticPlay, setOptimisticPlay] = useState<boolean | null>(null);
  const displayPlaying = optimisticPlay ?? isPlaying;
  const isCursorHidden = isFullscreen && !showControls && displayPlaying;

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
    progressSessionRef.current?.dispose();
    const alreadyFinished = durationSeconds > 0 && initialFurthest >= durationSeconds;
    guardRef.current = new VideoPlaybackGuard({
      lessonId,
      videoId,
      duration: durationSeconds || 0,
      initialPosition: initialPosition || 0,
      initialFurthest: initialFurthest || 0,
      allowFreeSeek,
      isGuest: !accessToken,
      isCompleted: alreadyFinished,
      onSeekCorrection: (targetTime) => {
        try {
          playerRef.current?.seekTo?.(targetTime, true);
          setCurrentTime(targetTime);
        } catch {}
      },
    });
    sessionIdRef.current = guardRef.current.viewSessionId;
    const guard = guardRef.current;
    const session = new VideoProgressSession(guard, (payload, signal) => apiFetch(`/api/v1/lessons/${payload.lessonId}/progress`, {
      method: 'PATCH', signal, token: accessTokenRef.current,
      body: JSON.stringify({
        positionSeconds: payload.currentTime,
        furthestWatchedPositionSeconds: payload.furthest,
        playerDurationSeconds: payload.playerDurationSeconds,
        playbackRate: payload.playbackRate,
        event: payload.event,
        viewSessionId: payload.viewSessionId,
      }),
    }), () => guardRef.current === guard, (data, payload) => acceptedProgressRef.current(data, payload));
    progressSessionRef.current = session;
    isVerifyingEndedRef.current = false;
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
    playerStateRef.current = -1;
    setIsBuffering(false);
    setOptimisticPlay(null);
    clearPauseRetry();
    controls.reset();
    setPlaybackRate(1);
    playbackRateRef.current = 1;
    return () => session.dispose();
  }, [lessonId, youtubeVideoId, videoId]);

  // Update furthest and currentTime when props arrive asynchronously after mount (fixes F5 loss)
  useEffect(() => {
    const alreadyFinished = Boolean(allowFreeSeek || (durationSeconds > 0 && initialFurthest >= durationSeconds));
    guardRef.current.syncProps({
      initialFurthest: initialFurthest >= 0 ? initialFurthest : 0,
      duration: durationSeconds,
      allowFreeSeek,
      isGuest: !accessToken,
      isCompleted: alreadyFinished,
    });
    serverConfirmedFurthestRef.current = guardRef.current.serverConfirmedFurthest;
    setServerConfirmedFurthest(guardRef.current.serverConfirmedFurthest);
    setIsCompleted(alreadyFinished);
    setVerificationState(alreadyFinished ? 'COMPLETED' : 'IDLE');

    // Only seek to initialPosition if player hasn't started playing yet to avoid rewinding active playback
    if (initialPosition > 0 && currentTime === 0 && !isPlayingRef.current) {
      setCurrentTime(initialPosition);
      if (playerRef.current?.seekTo) {
        try {
          playerRef.current.seekTo(initialPosition, true);
        } catch {}
      }
    }
  }, [initialPosition, initialFurthest, durationSeconds, allowFreeSeek, accessToken]);

  // UI intent is independent of YouTube buffering and asynchronous player callbacks.
  const clearHideControls = useCallback(() => controls.clear(), [controls]);
  const revealControls = useCallback((delay = 2500) => controls.reveal(delay), [controls]);
  useEffect(() => controls.setPlaying(displayPlaying), [controls, displayPlaying]);

  const isGuest = !accessToken;

  // Send a server-authoritative heartbeat (only for logged-in learners).
  const sendProgress = useCallback(
    async (ct: number, ft: number, event: PlaybackEvent = 'HEARTBEAT', overrideRate?: number, critical?: boolean) => {
      if (!accessToken || isGuest) return null;
      const d = durationRef.current || duration || 0;
      const rate = overrideRate ?? (playerRef.current?.getPlaybackRate?.() || playbackRateRef.current || 1);
      return progressSessionRef.current?.send(ct, d, rate, event, critical) ?? null;
    },
    [accessToken, isGuest, duration]
  );

  useEffect(() => {
    sendProgressRef.current = sendProgress;
  }, [sendProgress]);;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    fullscreenModeRef.current = 'NONE';
    setFullscreenMode('NONE');
    setIsFullscreen(false);
    const fullscreen = new VideoFullscreen(wrapper, mode => {
      fullscreenModeRef.current = mode;
      setFullscreenMode(mode);
      setIsFullscreen(mode === 'NATIVE' || mode === 'THEATER');
      controls.endSeek();
      controls.reveal();
    });
    fullscreenControllerRef.current = fullscreen;
    return () => {
      fullscreen.dispose();
      fullscreenControllerRef.current = null;
    };
  }, [lessonId, youtubeVideoId, controls]);

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
          width: '100%',
          height: '100%',
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
              const ctNow = playerRef.current?.getCurrentTime?.() || 0;
              const previousState = playerStateRef.current;
              playerStateRef.current = e.data;
              guardRef.current.onStateChange(e.data, ctNow);

              if (e.data === YT_BUFFERING) {
                setIsBuffering(true);
              } else if (e.data === YT_PLAYING) {
                perfMark('playing');
                setIsBuffering(false);
                setIsPlaying(true);
                isPlayingRef.current = true;
                setVerificationState('PLAYING');
                setProgressNotice('');
                controls.setPlaying(true);
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                startUiTimer();
                startHeartbeat();
                const ct = playerRef.current?.getCurrentTime?.() || 0;
                if (previousState !== YT_PLAYING && controls.seekingPointerId === null) void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'PLAY');
              } else if (e.data === YT_PAUSED) {
                perfMark('pause_applied');
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                controls.setPlaying(false);
                try {
                  e.target.unloadModule?.('captions');
                } catch {}
                if (!isVerifyingEndedRef.current && verificationState !== 'COMPLETED') {
                  const ct = playerRef.current?.getCurrentTime?.() || 0;
                  if (controls.seekingPointerId === null) void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'PAUSE');
                }
              } else if (e.data === YT_ENDED) {
                controls.setPlaying(false);
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                stopUiTimer();
                stopHeartbeat();
                void finishPlaybackRef.current();
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
    // Strict identity validation: ignore response belonging to another lesson or session
    if (result.lessonId && result.lessonId !== lessonId) return;
    if (result.videoId && result.videoId !== videoId) return;
    if (result.viewSessionId && result.viewSessionId !== guardRef.current.viewSessionId) return;

    const serverFurthest = Number(result.furthestWatchedPositionSeconds);
    if (Number.isFinite(serverFurthest) && serverFurthest >= 0) {
      guardRef.current.updateServerFurthestFromProps(serverFurthest);
      serverConfirmedFurthestRef.current = guardRef.current.serverConfirmedFurthest;
      setServerConfirmedFurthest(guardRef.current.serverConfirmedFurthest);
    }
    if (isServerVideoCompleted(result)) {
      setIsCompleted(true);
      setVerificationState('COMPLETED');
      completedFiredRef.current = true;
      guardRef.current.isCompleted = true;
    }
  };

  acceptedProgressRef.current = (data, payload) => {
    applyServerProgress(data);
    onProgressApplied?.(data, payload);
  };

  const finishPlayback = async () => {
    if (isGuest || isVerifyingEndedRef.current || completedFiredRef.current) return;
    const currentSession = guardRef.current.viewSessionId;
    const currentLesson = lessonId;
    const originSession = progressSessionRef.current;
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
      if (guardRef.current.viewSessionId !== currentSession || progressSessionRef.current !== originSession) return;
      try {
        result = await originSession?.send(d, d, actualRate, 'ENDED');
        // Abort processing if user switched away to another lesson while request was in flight
        if (guardRef.current.viewSessionId !== currentSession || lessonId !== currentLesson) {
          return;
        }
        if (isServerVideoCompleted(result)) {
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

    if (guardRef.current.viewSessionId !== currentSession || lessonId !== currentLesson) {
      return;
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
  finishPlaybackRef.current = finishPlayback;

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
          guardRef.current.duration = d;
        }

        // Run anti-cheat guard tick: preserves continuous legitimate playback while intercepting forward jumps
        const tickRes = guardRef.current.onTick(ct);
        if (tickRes.shouldSeek) {
          try {
            playerRef.current?.seekTo?.(tickRes.seekTarget, true);
            setCurrentTime(tickRes.seekTarget);
          } catch {}
        } else {
          setCurrentTime(ct);
        }

        // Keep serverConfirmedFurthest synchronized with monotonic guard state
        if (guardRef.current.serverConfirmedFurthest !== serverConfirmedFurthestRef.current) {
          serverConfirmedFurthestRef.current = guardRef.current.serverConfirmedFurthest;
          setServerConfirmedFurthest(guardRef.current.serverConfirmedFurthest);
        }

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
    if (!accessTokenRef.current || heartbeatRef.current) return;
    const d = durationRef.current || duration;
    const intervalMs = d > 0 && d < 30 ? 3000 : 10000;

    heartbeatRef.current = setInterval(() => {
      try {
        if (isVerifyingEndedRef.current || completedFiredRef.current || controls.seekingPointerId !== null) return;
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'HEARTBEAT');
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
      void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, event);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isGuest]);

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

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dragCheckpointedRef = useRef(false);

  const seekTo = (targetTime: number, source: 'timeline' | 'button' | 'keyboard') => {
    const player = playerRef.current;
    if (!player) return;
    const position = player.getCurrentTime?.() || 0;
    if (source !== 'timeline' || !dragCheckpointedRef.current) {
      void sendProgressRef.current(position, serverConfirmedFurthestRef.current, 'HEARTBEAT', undefined, true);
      if (source === 'timeline') dragCheckpointedRef.current = true;
    }
    const { clampedTime } = guardRef.current.clampManualSeek(targetTime);
    guardRef.current.recordSeek(source, position, clampedTime);
    player.seekTo(clampedTime, true);
    setCurrentTime(clampedTime);
  };

  const performSeekFromClientX = (clientX: number, targetElement?: HTMLElement | null) => {
    if (!playerRef.current) return;
    const el = targetElement || timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = pos * duration;

    try {
      seekTo(targetTime, 'timeline');
    } catch {}
  };

  const seekFromClientXRef = useRef(performSeekFromClientX);
  seekFromClientXRef.current = performSeekFromClientX;

  const finishSeek = useCallback((event: { pointerId: number; clientX: number; clientY: number }, commit: boolean) => {
    if (controls.seekingPointerId !== event.pointerId) return;
    if (commit) seekFromClientXRef.current(event.clientX);
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) controls.pointerInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    controls.endSeek(event.pointerId);
    dragCheckpointedRef.current = false;
    const ct = playerRef.current?.getCurrentTime?.() || 0;
    void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, isPlayingRef.current ? 'PLAY' : 'PAUSE');
    try { timelineRef.current?.releasePointerCapture(event.pointerId); } catch {}
  }, [controls]);

  const handleTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    if (!controls.beginSeek(e.pointerId)) return;
    dragCheckpointedRef.current = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    performSeekFromClientX(e.clientX, e.currentTarget);
  };

  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controls.seekingPointerId === e.pointerId) performSeekFromClientX(e.clientX, e.currentTarget);
  };

  // Capture at window level too: pointer capture may fail or be lost outside the player.
  useEffect(() => {
    const pointerUp = (event: PointerEvent) => finishSeek(event, true);
    const pointerCancel = (event: PointerEvent) => finishSeek(event, false);
    const blur = () => controls.windowBlur();
    const visibility = () => { if (document.hidden) blur(); };
    const keyboard = () => {
      controls.keyDown();
      if (wrapperRef.current?.contains(document.activeElement)) controls.focus();
    };
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', keyboard, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerup', pointerUp, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('visibilitychange', visibility);
      controls.clear();
    };
  }, [controls, finishSeek]);

  const setSpeed = (rate: number) => {
    if (!playerRef.current) return;
    try {
      const ct = playerRef.current.getCurrentTime?.() || 0;
      const oldRate = playerRef.current.getPlaybackRate?.() || playbackRateRef.current;
      void sendProgressRef.current(ct, serverConfirmedFurthestRef.current, 'HEARTBEAT', oldRate, true);
      playerRef.current.setPlaybackRate(rate);
      playbackRateRef.current = rate;
      setPlaybackRate(rate);
      guardRef.current.setPlaybackRate(rate);
    } catch {}
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setSpeed(nextRate);
  };

  const toggleFullscreen = () => {
    revealControls();
    void fullscreenControllerRef.current?.toggle();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) controls.pointerMove(e.clientX, e.clientY, fullscreenModeRef.current === 'NATIVE' || fullscreenModeRef.current === 'THEATER', rect, e.pointerType);
  };

  const handleControlsBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) controls.blur();
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canSeekFree = allowFreeSeek || isGuest || isCompleted;
  const allowedSeekPercent = duration > 0 ? ((canSeekFree ? duration : guardRef.current.computeAllowedManualSeekUntil()) / duration) * 100 : 0;

  const seekDelta = (deltaSeconds: number, source: 'button' | 'keyboard' = 'button') => {
    if (!playerRef.current) return;
    try {
      const ct = playerRef.current.getCurrentTime?.() || 0;
      const d = durationRef.current || duration || Infinity;
      const targetTime = Math.max(0, Math.min(d, ct + deltaSeconds));
      seekTo(targetTime, source);
      revealControls(2500);
    } catch {}
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'Escape' && fullscreenModeRef.current === 'THEATER') {
        e.preventDefault();
        fullscreenControllerRef.current?.exit();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekDelta(-10, 'keyboard');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekDelta(10, 'keyboard');
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
      data-video-player
      data-fullscreen-mode={fullscreenMode}
      onPointerEnter={e => controls.pointerEnter(e.clientX, e.clientY, e.pointerType)}
      onPointerMove={handlePointerMove}
      onPointerLeave={e => controls.pointerLeave(e.pointerType)}
      onPointerDownCapture={e => controls.pointerInput(e.pointerType)}
      onFocusCapture={() => controls.focus()}
      onBlurCapture={handleControlsBlur}
      className={`w-full bg-black select-none group transition-[border-radius] duration-200 ${
        isFullscreen && isCursorHidden && displayPlaying ? '!cursor-none' : 'cursor-default'
      } ${
        isFullscreen
          ? 'bbe-player-fullscreen rounded-none aspect-auto overflow-hidden flex items-center justify-center'
          : 'relative aspect-video rounded-3xl overflow-hidden'
      }`}
    >
      {fullscreenMode === 'THEATER' && showControls && !isStandaloneApp && (
        <span role="status" className="pointer-events-none absolute left-4 top-4 z-40 rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-white mt-[env(safe-area-inset-top)] ml-[env(safe-area-inset-left)]" title="Trình duyệt không cho phép toàn màn hình thiết bị với player này; thanh địa chỉ có thể vẫn hiển thị.">
          Xem rộng trong trình duyệt
        </span>
      )}
      {fullscreenMode === 'UNAVAILABLE' && (
        <p role="status" className="pointer-events-none absolute left-4 right-4 top-4 z-40 rounded-lg bg-slate-900/95 px-3 py-2 text-center text-xs text-white">Không thể mở toàn màn hình trên trình duyệt này. Bạn có thể tiếp tục xem trong trang.</p>
      )}
      {/* Explicit Exit Fullscreen Button in Theater / Fullscreen Mode (Essential for mobile & iOS) */}
      {isFullscreen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          className="absolute top-4 right-4 z-40 px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 active:bg-slate-700 text-white border border-slate-700/80 text-xs font-bold flex items-center gap-1.5 shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer touch-manipulation select-none mt-[env(safe-area-inset-top)] mr-[env(safe-area-inset-right)]"
          title="Thu nhỏ màn hình (Esc)"
        >
          <span className="text-sm">🗗</span>
          <span>Thu nhỏ</span>
        </button>
      )}

      {/* YouTube Player Native Container */}
      <div
        ref={containerRef}
        className="w-full h-full pointer-events-none origin-center flex items-center justify-center overflow-hidden"
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
        <div onClick={togglePlay} className="absolute inset-x-0 top-0 bottom-24 cursor-pointer z-10" />
      )}

      {/* Video tạm dừng: giữ nguyên frame đang hiển thị — KHÔNG phủ gradient tối đen che mờ video,
          chỉ hiển thị nhãn nổi bo góc tương phản cao ở giữa khung hình */}
      {!videoError && isReady && !displayPlaying && (
        <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center">
          <span className="rounded-full bg-slate-900/90 border border-slate-600/80 px-4 py-1.5 text-xs font-bold text-white shadow-xl backdrop-blur-md">
            ▶ Bấm để phát
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

      {/* High-Contrast Floating Video Controls Bar */}
      {!videoError && isReady && (
        <div
          data-video-controls
          onClickCapture={() => controls.reveal()}
          className={`absolute bottom-0 inset-x-0 z-30 transition-all duration-300 select-none ${
            showControls || !displayPlaying ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          {/* Pure Floating Controls: NO dark gradient or black band covering the video bottom.
              Every control element has its own compact high-contrast pill backdrop. */}

          <div className="relative px-3 sm:px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {/* Timeline Bar (High-Contrast Track with distinct scrubber thumb) */}
            <div
              ref={timelineRef}
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={e => finishSeek(e, true)}
              onPointerCancel={e => finishSeek(e, false)}
              onLostPointerCapture={e => finishSeek(e, false)}
              data-video-timeline
              className="relative py-2.5 cursor-pointer group/timeline select-none touch-none"
              title={canSeekFree ? 'Bấm để tua video' : 'Chỉ có thể tua trong đoạn đã xem'}
            >
              {/* Timeline Track (Solid Dark Slate Track with subtle border & shadow) */}
              <div className="relative h-2 w-full bg-slate-800/90 rounded-full overflow-hidden border border-slate-600/70 shadow-sm backdrop-blur-xs">
                {/* Furthest Watched Bar (Allowed Seek Range for Members) */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-slate-400/90 rounded-full transition-all duration-150"
                  style={{ width: `${canSeekFree ? 100 : allowedSeekPercent}%` }}
                />
                {/* Current Watched Position (Vibrant BBE Blue) */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-[#2563EB] rounded-full transition-all duration-75 shadow-sm"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Scrubber Playhead Handle (White Thumb with BBE Blue ring) */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-white border-2 border-[#2563EB] rounded-full shadow-md pointer-events-none transition-transform group-hover/timeline:scale-125"
                style={{ left: `${Math.min(100, Math.max(0, progressPercent))}%` }}
              />
            </div>

            {/* Bottom Row Controls */}
            <div className="flex items-center justify-between gap-1 sm:gap-2 text-white">
              {/* Left Group: Play/Pause, Rewind 10s, Forward 10s, Time Display, Status Badge */}
              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                {/* Play / Pause Button */}
                <button
                  type="button"
                  onClick={togglePlay}
                  className="min-w-[36px] h-[36px] sm:min-w-[40px] sm:h-[40px] px-2 shrink-0 flex items-center justify-center bg-[#1e293b]/90 hover:bg-[#334155] active:bg-[#475569] text-white border border-slate-600/80 rounded-xl text-xs sm:text-sm font-bold transition shadow-md backdrop-blur-sm cursor-pointer touch-manipulation select-none"
                  title={displayPlaying ? 'Tạm dừng (Phím cách/Space)' : 'Phát video (Phím cách/Space)'}
                >
                  {displayPlaying ? '⏸' : '▶'}
                </button>

                {/* Rewind 10s */}
                <button
                  type="button"
                  onClick={() => seekDelta(-10)}
                  className="h-[36px] sm:h-[40px] px-2 sm:px-2.5 shrink-0 flex items-center gap-0.5 sm:gap-1 bg-[#1e293b]/90 hover:bg-[#334155] active:bg-[#475569] text-[#F1F5F9] border border-slate-600/80 rounded-xl text-[11px] sm:text-xs font-bold transition shadow-md backdrop-blur-sm cursor-pointer touch-manipulation select-none"
                  title="Tua lùi 10 giây (Phím mũi tên trái ←)"
                >
                  <span className="text-xs">↺</span>
                  <span>10s</span>
                </button>

                {/* Forward 10s */}
                <button
                  type="button"
                  disabled={!canSeekFree && currentTime + 3 >= guardRef.current.computeAllowedManualSeekUntil()}
                  onClick={() => seekDelta(10)}
                  className="h-[36px] sm:h-[40px] px-2 sm:px-2.5 shrink-0 flex items-center gap-0.5 sm:gap-1 bg-[#1e293b]/90 hover:bg-[#334155] active:bg-[#475569] disabled:opacity-35 disabled:cursor-not-allowed text-[#F1F5F9] border border-slate-600/80 rounded-xl text-[11px] sm:text-xs font-bold transition shadow-md backdrop-blur-sm cursor-pointer touch-manipulation select-none"
                  title={canSeekFree || currentTime + 3 < guardRef.current.computeAllowedManualSeekUntil() ? 'Tua tới 10 giây (Phím mũi tên phải →)' : 'Học viên không thể tua tới đoạn chưa học'}
                >
                  <span>10s</span>
                  <span className="text-xs">↻</span>
                </button>

                {/* Floating High-Contrast Time Display Badge */}
                <div className="flex items-center text-[11px] sm:text-xs font-bold tabular-nums ml-0.5 sm:ml-1 whitespace-nowrap select-none bg-[#0f172a]/85 border border-slate-700/70 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl shadow-md backdrop-blur-xs">
                  <span className="text-white">{formatTime(currentTime)}</span>
                  <span className="text-slate-400 mx-1">/</span>
                  <span className="text-slate-300">{formatTime(duration)}</span>
                </div>

                {/* Status Badge */}
                {canSeekFree ? (
                  <span className="text-[10px] text-amber-200 font-semibold px-2 py-1 bg-amber-950/85 border border-amber-600/60 rounded-xl shadow-md backdrop-blur-xs hidden lg:inline-flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Có thể tua
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300 font-semibold px-2 py-1 bg-slate-800/85 border border-slate-700/70 rounded-xl shadow-md backdrop-blur-xs hidden xl:inline-flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    Chưa mở tua tới
                  </span>
                )}
              </div>

              {/* Right Group: Playback Speed & Fullscreen */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Mobile Speed Cycle Button */}
                <button
                  type="button"
                  onClick={cyclePlaybackRate}
                  className="sm:hidden h-[36px] min-w-[36px] px-2 rounded-xl text-xs bg-[#1e293b]/90 hover:bg-[#334155] active:bg-[#475569] text-white font-bold border border-slate-600/80 transition shadow-md backdrop-blur-sm shrink-0 flex items-center justify-center cursor-pointer touch-manipulation select-none"
                  title="Đổi tốc độ phát (chạm để chuyển)"
                >
                  {playbackRate}x
                </button>

                {/* Desktop Playback Speed Controls */}
                <div className="hidden sm:flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-xl border border-slate-700/80 shadow-md backdrop-blur-sm">
                  <span className="text-slate-400 text-[11px] px-1.5 font-medium hidden md:inline">Tốc độ:</span>
                  {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setSpeed(rate)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-[#2563EB] text-white shadow-sm'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'
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
                  className="min-w-[36px] h-[36px] sm:min-w-[40px] sm:h-[40px] flex items-center justify-center bg-[#1e293b]/90 hover:bg-[#334155] active:bg-[#475569] text-white border border-slate-600/80 rounded-xl text-xs sm:text-sm font-bold transition shadow-md backdrop-blur-sm shrink-0 cursor-pointer touch-manipulation select-none"
                  title={isFullscreen ? 'Thu nhỏ màn hình (Esc)' : 'Toàn màn hình (Fullscreen)'}
                >
                  {isFullscreen ? '🗗' : '⛶'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
