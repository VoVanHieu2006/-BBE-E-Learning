'use client';

import React, { useState, useRef, useEffect } from 'react';

export interface MonthPickerProps {
  value: string; // Format 'YYYY-MM' (e.g. '2026-10')
  onChange: (month: string) => void;
  availableMonths?: string[]; // e.g. ['2026-11', '2026-10', '2026-09', ...]
  disabled?: boolean;
  className?: string;
}

const MONTH_NAMES = [
  'Thg 1',
  'Thg 2',
  'Thg 3',
  'Thg 4',
  'Thg 5',
  'Thg 6',
  'Thg 7',
  'Thg 8',
  'Thg 9',
  'Thg 10',
  'Thg 11',
  'Thg 12',
];

export default function MonthPicker({
  value,
  onChange,
  availableMonths = [],
  disabled = false,
  className = '',
}: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial year from value, fallback to current year
  const initialYear = value && value.includes('-')
    ? parseInt(value.split('-')[0], 10)
    : new Date().getFullYear();

  const [displayYear, setDisplayYear] = useState<number>(initialYear);

  useEffect(() => {
    if (value && value.includes('-')) {
      const parsedYear = parseInt(value.split('-')[0], 10);
      if (!isNaN(parsedYear)) {
        setDisplayYear(parsedYear);
      }
    }
  }, [value]);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close if disabled
  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  // Formatted trigger label: "Tháng MM/YYYY"
  const formattedLabel = (() => {
    if (!value || !value.includes('-')) return 'Chọn tháng';
    const [y, m] = value.split('-');
    return `Tháng ${m}/${y}`;
  })();

  const handleSelectMonth = (monthIndex: number) => {
    if (disabled) return;
    const monthKey = `${displayYear}-${String(monthIndex + 1).padStart(2, '0')}`;
    if (monthKey !== value) {
      onChange(monthKey);
    }
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2.5 rounded-xl border border-[#cbdbf5] bg-white px-3.5 py-2 text-sm font-semibold text-[#172554] shadow-sm transition hover:border-[#2563EB] hover:bg-blue-50/30 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        } ${isOpen ? 'ring-2 ring-[#2563EB]/20 border-[#2563EB]' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className="text-base select-none">📅</span>
        <span className="font-semibold">{formattedLabel}</span>
        {disabled ? (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent ml-0.5" />
        ) : (
          <span className="text-[10px] text-[#737686] transition-transform select-none">
            {isOpen ? '▲' : '▼'}
          </span>
        )}
      </button>

      {/* Popover Calendar Grid */}
      {isOpen && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-[#eff4ff] bg-white p-3.5 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
          {/* Year selector header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#eff4ff]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDisplayYear((y) => y - 1)}
              className="rounded-lg p-1.5 text-xs font-bold text-[#434655] hover:bg-gray-100 transition"
              title="Năm trước"
            >
              ‹ Năm trước
            </button>
            <span className="font-bold text-[#172554] text-base">{displayYear}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDisplayYear((y) => y + 1)}
              className="rounded-lg p-1.5 text-xs font-bold text-[#434655] hover:bg-gray-100 transition"
              title="Năm sau"
            >
              Năm sau ›
            </button>
          </div>

          {/* 12 Months Grid */}
          <div className="grid grid-cols-3 gap-2 py-3">
            {MONTH_NAMES.map((name, idx) => {
              const monthKey = `${displayYear}-${String(idx + 1).padStart(2, '0')}`;
              const isSelected = value === monthKey;
              const hasData = availableMonths.includes(monthKey);

              return (
                <button
                  key={monthKey}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectMonth(idx)}
                  className={`group relative flex flex-col items-center justify-center rounded-xl py-2 px-1 text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-[#2563EB] text-white shadow-sm ring-2 ring-blue-300'
                      : hasData
                      ? 'bg-emerald-50 text-[#172554] border border-emerald-200/80 hover:bg-emerald-100'
                      : 'text-[#434655] hover:bg-gray-100 border border-transparent'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                >
                  <span>{name}</span>
                  {hasData && (
                    <span
                      className={`mt-0.5 inline-flex items-center gap-1 text-[9px] font-medium leading-none ${
                        isSelected ? 'text-blue-100' : 'text-emerald-700'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-emerald-500'
                        }`}
                      />
                      Có số liệu
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Popover Footer Legend */}
          <div className="flex items-center justify-between border-t border-[#eff4ff] pt-2.5 text-[11px] text-[#737686]">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Có dữ liệu xếp hạng</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                setDisplayYear(now.getFullYear());
                if (value !== nowKey && !disabled) {
                  onChange(nowKey);
                }
                setIsOpen(false);
              }}
              className="font-semibold text-[#2563EB] hover:underline"
            >
              Tháng này
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
