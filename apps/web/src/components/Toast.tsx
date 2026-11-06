'use client';

import { CheckCircle2, X } from 'lucide-react';
import { useEffect } from 'react';

interface ToastProps {
  message: string | null;
  onClose: () => void;
  durationMs?: number;
}

export function Toast({ message, onClose, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, onClose]);

  if (!message) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-50 flex max-w-md items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-stone-900 text-sm shadow-xl ring-1 ring-black/5 sm:top-5 sm:right-6"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
        <CheckCircle2 className="h-4 w-4" />
      </span>
      <p className="flex-1 font-medium text-stone-900 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
