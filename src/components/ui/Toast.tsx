'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ToastMessage {
  id?: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ toast, onClose, duration = 4000 }: ToastProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onClose, duration]);

  if (!toast || !mounted) return null;

  const isSuccess = toast.type === 'success';
  const isError = toast.type === 'error';

  const content = (
    <div className="fixed top-6 right-6 z-[99999] max-w-md w-[calc(100%-3rem)] sm:w-full select-none pointer-events-auto">
      <div
        className={`p-4 rounded-2xl border-2 flex items-start gap-3 backdrop-blur-xl transition-all shadow-2xl ${
          isSuccess
            ? 'bg-emerald-950/95 border-emerald-500 text-white'
            : isError
            ? 'bg-red-950/95 border-red-500 text-white'
            : 'bg-slate-900/95 border-blue-500 text-white'
        }`}
      >
        <span className="text-2xl shrink-0 mt-0.5">
          {isSuccess ? '✅' : isError ? '⚠️' : 'ℹ️'}
        </span>

        <div className="flex-1 overflow-hidden">
          {toast.title && <h5 className="font-bold text-sm mb-1 text-white">{toast.title}</h5>}
          <p className="text-xs text-slate-100 font-medium leading-relaxed break-words">{toast.message}</p>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white font-bold text-base p-1 shrink-0 rounded-lg hover:bg-white/10 transition"
        >
          ✕
        </button>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
}
