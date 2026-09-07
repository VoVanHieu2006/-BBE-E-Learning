import { design } from '@/lib/design';
export default function Card({ children, className = '', shadow = 'md' }: { children: React.ReactNode; className?: string; shadow?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#eff4ff] ${design.shadow[shadow] || design.shadow.md} p-6 ${className}`}>
      {children}
    </div>
  );
}
