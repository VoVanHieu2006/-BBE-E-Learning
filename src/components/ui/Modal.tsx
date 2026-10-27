'use client';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import motionStyle from './ModalMotion.module.css';
import { PilotVisibility } from '@/components/layout/PilotVisibility';

// Shared scroll-lock state across ALL Modal instances (module-level) so nested
// modals never restore a stale body overflow when closing in any order.
let lockCount = 0;
let savedOverflow: string | null = null;
let modalSeq = 0;
const modalStack: Array<{ id: number; close: () => void }> = [];

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusTrapHandler(event: KeyboardEvent, dialog: HTMLElement) {
  if (event.key !== 'Tab' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const goingBack = event.shiftKey || event.key === 'ArrowUp';
  if (event.key !== 'Tab') {
    // Arrow keys must keep working inside inputs (radio groups, selects).
    const tag = active?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
  }
  if (!dialog.contains(active)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (!goingBack && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (goingBack && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  return false;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  closeOnBackdrop?: boolean;
  motion?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidth = 'max-w-3xl',
  className = '',
  closeOnBackdrop = true,
  motion = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const portalVisible = useContext(PilotVisibility);
  const visibleRef = useRef(portalVisible);
  visibleRef.current = portalVisible;
  const lastInsideFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if(portalVisible && isOpen && mounted && lastInsideFocus.current?.isConnected)lastInsideFocus.current.focus();
  },[portalVisible,isOpen,mounted]);

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

    // Focus trap: the dialog owns Tab, Escape returns focus where it came from.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null)
      : [];
    focusables[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visibleRef.current) return;
      if (e.key === 'Escape') {
        const top = modalStack[modalStack.length - 1];
        if (top && top.id === id) top.close();
        return;
      }
      if (modalStack[modalStack.length - 1]?.id === id && dialogRef.current) {
        focusTrapHandler(e, dialogRef.current);
      }
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
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [isOpen, mounted]);

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  const content = (
    <div
      ref={node=>{dialogRef.current=node;if(node)node.inert=!portalVisible;}}
      onFocusCapture={event=>{lastInsideFocus.current=event.target as HTMLElement;}}
      className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
      aria-modal="true"
      aria-hidden={!portalVisible}
      style={portalVisible ? undefined : {visibility:'hidden',pointerEvents:'none'}}
      role="dialog"
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-3xl shadow-2xl overflow-hidden my-auto ${motion ? motionStyle.enter : ''} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
