import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safe toFixed utility that handles null, undefined, strings, and NaN values
 * @param value The value to format (can be number, string, null, or undefined)
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string with specified decimal places, or "0" if value is invalid
 */
export function safeToFixed(
  value: string | number | null | undefined,
  decimals: number = 2
): string {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return '0'.padEnd(decimals > 0 ? decimals + 2 : 1, '0')
  }

  // Convert to number
  const numValue = typeof value === 'string' ? parseFloat(value) : Number(value)

  // Check for NaN
  if (isNaN(numValue)) {
    return '0'.padEnd(decimals > 0 ? decimals + 2 : 1, '0')
  }

  // Check for infinite values
  if (!isFinite(numValue)) {
    return '0'.padEnd(decimals > 0 ? decimals + 2 : 1, '0')
  }

  // Safe toFixed call
  return numValue.toFixed(decimals)
}
