'use client';
import { getHighlightSegments } from '@/lib/quiz-search';

export default function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {getHighlightSegments(text, query).map((segment, index) => segment.match
        ? <mark key={index} className="rounded bg-yellow-200 px-0.5 text-[#172554]">{segment.text}</mark>
        : <span key={index}>{segment.text}</span>)}
    </>
  );
}
