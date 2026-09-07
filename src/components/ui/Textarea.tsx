'use client';
import { design } from '@/lib/design';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export default function Textarea({ label, error, className, ...props }: TextareaProps) {
  const base = 'w-full px-4 py-3 border rounded-xl text-[#0b1c30] placeholder-[#737686] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent';
  const errClass = error ? 'border-red-300 focus:ring-red-500' : 'border-[#cbdbf5]';
  return (
    <div className={className}>
      {label && <label className="block text-sm font-semibold text-[#172554] mb-1.5">{label}</label>}
      <textarea className={`${base} ${errClass}`} {...props} />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
