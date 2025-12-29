import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert any value to a proper number type
 * Used at API level to ensure all numeric fields are properly typed before sending to frontend
 * @param value The value to convert (can be number, string, null, undefined, etc.)
 * @param defaultValue Default value if conversion fails (default: 0)
 * @returns Proper number type, or defaultValue if conversion fails
 */
export function toNumber(
  value: any,
  defaultValue: number = 0
): number {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return defaultValue
  }

  // Convert to number
  const numValue = typeof value === 'string' ? parseFloat(value) : Number(value)

  // Check for NaN or infinite values
  if (!isFinite(numValue)) {
    return defaultValue
  }

  return numValue
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
  const numValue = toNumber(value, 0)
  return numValue.toFixed(decimals)
}
