'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

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

interface Props {
  youtubeVideoId: string;
  lessonId: string;
  accessToken?: string;
  allowFreeSeek?: boolean;
  initialPosition?: number;
  initialFurthest?: number;
  durationSeconds?: number;
  onProgress?: (p: { currentTime: number; duration: number; furthest: number }) => void;
  onComplete?: () => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
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
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [furthest, setFurthest] = useState(initialFurthest);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState('');

  const furthestRef = useRef(initialFurthest);
  const durationRef = useRef(durationSeconds || 0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedFiredRef = useRef(false);

  const isGuest = !accessToken;

  // Send heartbeat progress update to server (only for logged-in members)
  const sendProgress = useCallback(
    async (ct: number, ft: number, forceCompleted: boolean = false) => {
      if (!accessToken) return;
      try {
        const d = durationRef.current || duration || 1;
        const isDone = forceCompleted || (d > 0 && ft / d >= 0.85);

        await fetch(`/api/v1/lessons/${lessonId}/progress`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            positionSeconds: Math.round(ct),
            furthestWatchedPositionSeconds: Math.round(ft),
            completed: isDone,
          }),
        });

        onProgress?.({ currentTime: Math.round(ct), duration: Math.round(d), furthest: Math.round(ft) });
      } catch {}
    },
    [lessonId, accessToken, duration, onProgress]
  );

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

  // Robust YouTube IFrame Player API loader and mounting
  useEffect(() => {
    let unmounted = false;
    let poller: ReturnType<typeof setInterval> | null = null;

    const initPlayer = () => {
      if (unmounted || !containerRef.current || !window.YT?.Player) return;

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
            fs: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: (e: any) => {
              if (unmounted) return;
              setIsReady(true);
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
              if (e.data === YT_PLAYING) {
                setIsPlaying(true);
                startUiTimer();
                startHeartbeat();
              } else if (e.data === YT_PAUSED) {
                setIsPlaying(false);
                stopUiTimer();
                stopHeartbeat();
                const ct = playerRef.current?.getCurrentTime?.() || 0;
                sendProgress(ct, furthestRef.current);
              } else if (e.data === YT_ENDED) {
                setIsPlaying(false);
                stopUiTimer();
                stopHeartbeat();
                const d = durationRef.current || duration;
                furthestRef.current = d;
                setFurthest(d);
                if (!isGuest) {
                  setIsCompleted(true);
                  completedFiredRef.current = true;
                  sendProgress(d, d, true);
                  onComplete?.();
                }
              }
            },
            onError: (e: any) => {
              if (unmounted) return;
              let msg = 'Không thể tải video YouTube.';
              if (e.data === 100 || e.data === 101 || e.data === 150) {
                msg = 'Video này ở chế độ riêng tư hoặc không cho phép phát lại ngoài YouTube.';
              } else if (e.data === 2) {
                msg = 'ID video YouTube không hợp lệ.';
              }
              setVideoError(msg);
            },
          },
        });
      } catch (err) {
        console.error('[YT PLAYER INIT ERROR]:', err);
        setIsReady(true);
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
        document.head.appendChild(tag);
      }

      poller = setInterval(() => {
        if (window.YT && typeof window.YT.Player === 'function') {
          if (poller) clearInterval(poller);
          initPlayer();
        }
      }, 150);
    }

    return () => {
      unmounted = true;
      if (poller) clearInterval(poller);
      stopHeartbeat();
      stopUiTimer();
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
    };
  }, [youtubeVideoId]);

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
        const newFurthest = Math.max(furthestRef.current, ct);
        furthestRef.current = newFurthest;
        setCurrentTime(ct);
        setFurthest(newFurthest);

        // Progress >= 85% marks completed (only for members with account)
        if (!isGuest && !completedFiredRef.current && d > 0 && newFurthest / d >= 0.85) {
          completedFiredRef.current = true;
          setIsCompleted(true);
          sendProgress(ct, newFurthest, true);
          onComplete?.();
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
    const intervalMs = d > 0 && d < 30 ? 3000 : 8000;

    heartbeatRef.current = setInterval(() => {
      try {
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        sendProgress(ct, furthestRef.current);
      } catch {}
    }, intervalMs);
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // Anti-cheat seek-ahead guard for Member role (BR-03: Members CANNOT seek past furthest watched position)
  // Skipped for guests and Admin/BĐHU (allowFreeSeek === true)
  useEffect(() => {
    if (allowFreeSeek || isGuest || !isReady || videoError) return;
    const guard = setInterval(() => {
      try {
        const ct = playerRef.current?.getCurrentTime?.() || 0;
        if (ct > furthestRef.current + 6) {
          playerRef.current?.seekTo?.(furthestRef.current, true);
          setCurrentTime(furthestRef.current);
        }
      } catch {}
    }, 500);

    return () => clearInterval(guard);
  }, [isReady, videoError, allowFreeSeek, isGuest]);

  const togglePlay = () => {
    if (!playerRef.current || !isReady) {
      pendingPlayRef.current = true;
      return;
    }
    try {
      if (isPlaying) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
      }
    } catch {
      pendingPlayRef.current = true;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const targetTime = pos * duration;

    // BR-03: Member can only seek backwards or up to furthest watched position, UNLESS allowFreeSeek or isGuest
    if (allowFreeSeek || isGuest || targetTime <= furthestRef.current + 3) {
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
      setPlaybackRate(rate);
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
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const furthestPercent = duration > 0 ? (furthest / duration) * 100 : 0;
  const canSeekFree = allowFreeSeek || isGuest;

  return (
    <div
      ref={wrapperRef}
      onMouseMove={handleMouseMove}
      className={`relative w-full aspect-video bg-black overflow-hidden select-none group ${
        isFullscreen ? 'rounded-none max-h-screen' : 'rounded-3xl'
      }`}
    >
      {/* YouTube Player Native Container */}
      <div ref={containerRef} className="w-full h-full pointer-events-none" />

      {/* Loading Skeleton */}
      {!isReady && !videoError && (
        <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-6 text-white z-20">
          <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-xs text-slate-300 font-medium">Đang tải video bài giảng...</p>
        </div>
      )}

      {videoError && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-6 text-center text-white z-40">
          <div className="text-4xl mb-3">⚠️</div>
          <h4 className="text-lg font-bold mb-1">Không thể phát video</h4>
          <p className="text-xs text-slate-300 max-w-md mb-4">{videoError}</p>
          <a
            href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-xs font-semibold rounded-xl"
          >
            Xem trực tiếp trên YouTube →
          </a>
        </div>
      )}

      {/* Play/Pause Click Overlay (no redundant central logo over YouTube thumbnail) */}
      {!videoError && isReady && (
        <div onClick={togglePlay} className="absolute inset-0 cursor-pointer z-10" />
      )}

      {/* Completion Banner (only for logged-in accounts) */}
      {!isGuest && isCompleted && (
        <div className="absolute top-4 left-4 z-20 bg-green-900/90 border border-green-500/40 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg backdrop-blur-sm animate-fade-in">
          <span>✓</span> Đã hoàn thành bài học (≥ 85%)
        </div>
      )}

      {/* Custom Video Controls Bar */}
      {!videoError && isReady && (
        <div
          className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 z-30 transition-opacity duration-300 ${
            showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Bar */}
          <div
            onClick={handleSeek}
            className="relative h-2 bg-white/20 rounded-full cursor-pointer mb-3 group/timeline overflow-hidden"
            title={canSeekFree ? 'Bấm để tua video' : 'Thành viên chỉ được tua trong đoạn đã xem (BR-03)'}
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
                title={isPlaying ? 'Tạm dừng' : 'Phát video'}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              <span>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {canSeekFree ? (
                <span className="text-[10px] text-amber-300 font-normal px-2 py-0.5 bg-amber-900/40 rounded-full">
                  {isGuest ? 'Khách (Tự do tua)' : 'Quản trị (Tự do tua)'}
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 font-normal px-2 py-0.5 bg-slate-800/60 rounded-full hidden sm:inline">
                  Chống tua gian lận (BR-03)
                </span>
              )}
            </div>

            {/* Right Controls: Speed & Fullscreen */}
            <div className="flex items-center gap-2">
              {/* Playback Speed Controls */}
              <div className="flex items-center gap-1">
                <span className="text-slate-300 text-[11px] hidden sm:inline">Tốc độ:</span>
                {[1, 1.25, 1.5, 2].map((rate) => (
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
