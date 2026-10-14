import { design } from '@/lib/design';
type CardProps = React.HTMLAttributes<HTMLDivElement> & { shadow?: 'sm' | 'md' | 'lg' }
export default function Card({ children, className = '', shadow = 'md', ...props }: CardProps) {
  return (
    <div {...props} className={`bg-white rounded-2xl border border-[#eff4ff] ${design.shadow[shadow] || design.shadow.md} p-6 ${className}`}>
      {children}
    </div>
  );
}
