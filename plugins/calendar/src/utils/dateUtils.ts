/**
 * Date utility functions for the calendar plugin
 */

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a date string (YYYY-MM-DD) into a Date object
 */
export function parseDateString(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Handle YYYY-MM-DD format
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  // Try parsing as a general date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return null;
}

/**
 * Get the first day of the month
 */
export function getFirstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the last day of the month
 */
export function getLastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Get the number of days in a month
 */
export function getDaysInMonth(date: Date): number {
  return getLastDayOfMonth(date).getDate();
}

/**
 * Get the week number for a date (ISO week)
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Get an array of dates for a month grid (including padding days)
 */
export function getMonthGridDates(date: Date, startWeekOn: 'sunday' | 'monday'): Date[] {
  const firstDay = getFirstDayOfMonth(date);
  const lastDay = getLastDayOfMonth(date);
  const dates: Date[] = [];
  
  // Determine the start offset
  let startDayOfWeek = firstDay.getDay(); // 0 = Sunday
  if (startWeekOn === 'monday') {
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
  }
  
  // Add padding days from previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(firstDay);
    d.setDate(d.getDate() - i - 1);
    dates.push(d);
  }
  
  // Add days of current month
  for (let i = 1; i <= getDaysInMonth(date); i++) {
    dates.push(new Date(date.getFullYear(), date.getMonth(), i));
  }
  
  // Add padding days from next month to complete the grid (6 rows = 42 days)
  const remainingDays = 42 - dates.length;
  for (let i = 1; i <= remainingDays; i++) {
    const d = new Date(lastDay);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  
  return dates;
}

/**
 * Get an array of dates for a week view
 */
export function getWeekDates(date: Date, startWeekOn: 'sunday' | 'monday'): Date[] {
  const dates: Date[] = [];
  const current = new Date(date);
  
  // Find the start of the week
  let dayOfWeek = current.getDay();
  if (startWeekOn === 'monday') {
    dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  }
  
  current.setDate(current.getDate() - dayOfWeek);
  
  // Add 7 days
  for (let i = 0; i < 7; i++) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

/**
 * Format month and year for display
 */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Format date for display
 */
export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Get weekday names
 */
export function getWeekdayNames(startWeekOn: 'sunday' | 'monday', short = true): string[] {
  const days = short 
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  if (startWeekOn === 'monday') {
    const sunday = days.shift()!;
    days.push(sunday);
  }
  
  return days;
}

/**
 * Navigate to previous month
 */
export function getPreviousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

/**
 * Navigate to next month
 */
export function getNextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/**
 * Navigate to previous week
 */
export function getPreviousWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - 7);
  return d;
}

/**
 * Navigate to next week
 */
export function getNextWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 7);
  return d;
}
