'use client';

import { useEffect, useState } from 'react';

export default function TermTransitionCountdown({
  targetDate,
  onExpire,
}: {
  targetDate: string;
  onExpire: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isDue: boolean;
  } | null>(null);

  useEffect(() => {
    const targetMs = new Date(targetDate).getTime();
    if (isNaN(targetMs)) return;

    let hasExpired = false;

    function calculate() {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isDue: true });
        if (!hasExpired) {
          hasExpired = true;
          onExpire();
        }
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds, isDue: false });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [targetDate, onExpire]);

  if (!timeLeft) return null;

  if (timeLeft.isDue) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs animate-pulse">
        <span>⚡</span>
        <span>Đã đến giờ hiệu lực! Đang tự động chuyển giao...</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-600 text-white rounded-xl text-xs shadow-xs font-mono">
      <span className="text-amber-300 animate-pulse">⏳</span>
      <span className="font-sans font-semibold text-[11px] text-blue-100">Còn lại:</span>
      <span className="font-extrabold tracking-wider">
        {timeLeft.days > 0 ? `${timeLeft.days} ngày ` : ''}
        {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:{String(timeLeft.seconds).padStart(2, '0')}
      </span>
    </div>
  );
}
