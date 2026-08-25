import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
  }).format(amount);
}

/**
 * Formats currency specifically for PDF exports using Latin-1 / WinAnsi compatible characters.
 * Standard jsPDF fonts (Helvetica/Times/Courier) do not support the Unicode \u20B5 cedi character,
 * causing '?' or glyph corruption. Using 'GH¢' (\u00A2) guarantees a crisp, sharp Cedi symbol
 * across all PDF viewers and printers.
 */
export function formatPdfCurrency(amount: number | undefined | null): string {
  const val = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  const isNegative = val < 0;
  const absoluteVal = Math.abs(val);
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absoluteVal);

  return isNegative ? `-GH\u00A2 ${formattedNumber}` : `GH\u00A2 ${formattedNumber}`;
}

export function formatNumber(num: number) {
  return new Intl.NumberFormat('en-GH').format(num);
}
