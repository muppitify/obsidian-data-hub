/**
 * Color utility functions for the calendar plugin
 */

/**
 * Predefined color palette for calendar sources
 */
export const COLOR_PALETTE = [
  '#e74c3c', // Red
  '#f1c40f', // Yellow
  '#2ecc71', // Green
  '#3498db', // Blue
  '#9b59b6', // Purple
  '#e67e22', // Orange
  '#1abc9c', // Teal
  '#34495e', // Dark Gray
  '#e91e63', // Pink
  '#00bcd4', // Cyan
];

/**
 * Get a color from the palette by index
 */
export function getColorByIndex(index: number): string {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/**
 * Lighten a hex color by a percentage
 */
export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  
  return '#' + (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
}

/**
 * Darken a hex color by a percentage
 */
export function darkenColor(hex: string, percent: number): string {
  return lightenColor(hex, -percent);
}

/**
 * Get a contrasting text color (black or white) for a given background
 */
export function getContrastColor(hex: string): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const R = num >> 16;
  const G = num >> 8 & 0x00FF;
  const B = num & 0x0000FF;
  
  // Calculate relative luminance
  const luminance = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Validate a hex color string
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Convert hex to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Add alpha to a hex color (returns rgba string)
 */
export function addAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
