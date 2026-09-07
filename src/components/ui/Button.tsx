'use client';
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'navy' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingText?: string;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98] select-none';
  const sz =
    size === 'sm'
      ? 'px-3.5 py-1.5 text-xs rounded-xl gap-1.5'
      : size === 'lg'
      ? 'px-8 py-3.5 text-base rounded-2xl gap-2.5 font-bold'
      : 'px-5 py-2.5 text-sm rounded-xl gap-2';
  const v =
    variant === 'primary'
      ? 'bg-[#F97316] text-white hover:bg-[#ea580c] shadow-md shadow-orange-500/20'
      : variant === 'secondary'
      ? 'bg-[#2563EB] text-white hover:bg-[#1d4ed8] shadow-md shadow-blue-500/20'
      : variant === 'outline'
      ? 'bg-white text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#eff4ff]'
      : variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-500/20'
      : 'bg-[#172554] text-white hover:bg-[#0f172a] shadow-md';

  const isDisabled = disabled || loading;

  return (
    <button
      className={`${base} ${sz} ${v} ${className}`}
      disabled={isDisabled}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
