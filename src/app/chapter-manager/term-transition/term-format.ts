export const SAMPLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1MA9pJ1E8oHEZe8d1g6j0Ns6JqLoOCdhSVSgOflO0JBI/edit?gid=0#gid=0';

/**
 * Chuyển đổi số nguyên sang số La Mã (Roman Numerals)
 */
function toRoman(num: number): string {
  if (!num || num <= 0) return '';
  const romanMap: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  let n = Math.floor(num);
  for (const [val, roman] of romanMap) {
    while (n >= val) {
      result += roman;
      n -= val;
    }
  }
  return result;
}

/**
 * Định dạng nhãn nhiệm kỳ bao gồm cả số thường và số La Mã (Ví dụ: Nhiệm kỳ 6 - VI)
 */
export function formatTermBadge(termNum?: number | null): string {
  if (!termNum || termNum <= 0) return '';
  return `Nhiệm kỳ ${termNum} - ${toRoman(termNum)}`;
}
