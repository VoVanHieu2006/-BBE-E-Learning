'use client';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared scroll-lock state across ALL Modal instances (module-level) so nested
// modals never restore a stale body overflow when closing in any order.
let lockCount = 0;
let savedOverflow: string | null = null;
let modalSeq = 0;
const modalStack: Array<{ id: number; close: () => void }> = [];

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  closeOnBackdrop?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidth = 'max-w-3xl',
  className = '',
  closeOnBackdrop = true,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while any modal is open; only the first open captures the
  // original overflow and only the last close restores it (nested-modal safe).
  useEffect(() => {
    if (!isOpen || !mounted) return;

    lockCount++;
    const id = ++modalSeq;
    modalStack.push({ id, close: () => onCloseRef.current() });

    if (lockCount === 1) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const top = modalStack[modalStack.length - 1];
      if (top && top.id === id) top.close();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = modalStack.findIndex((m) => m.id === id);
      if (idx >= 0) modalStack.splice(idx, 1);
      lockCount--;
      if (lockCount === 0 && savedOverflow !== null) {
        document.body.style.overflow = savedOverflow;
        savedOverflow = null;
      }
    };
  }, [isOpen, mounted]);

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  const content = (
    <div
      className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-3xl shadow-2xl overflow-hidden my-auto ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
