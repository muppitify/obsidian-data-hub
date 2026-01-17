import { TFile } from 'obsidian';

/**
 * Display field configuration for showing metadata in calendar events
 */
export interface DisplayField {
  field: string;        // Frontmatter field name (e.g., 'timeAsleep')
  label: string;        // Display label (e.g., 'Sleep')
  format: 'none' | 'duration' | 'number';  // How to format the value
  unitField?: string;   // Optional field containing the unit (e.g., 'restingHeartRateUnit')
  unit?: string;        // Static unit to append (e.g., 'bpm')
}

/**
 * Represents a calendar source configuration
 */
export interface CalendarSource {
  id: string;
  name: string;
  folder: string;
  color: string;
  dateField: string;
  titleField?: string;
  imageField?: string;  // Frontmatter field containing image path
  imageFromLinkedNote?: string;  // Field containing link to note with the image (e.g., 'movie', 'show')
  highlightField?: string;  // Field to show prominently in a box (when no image)
  highlightFormat?: 'none' | 'duration' | 'number';  // How to format the highlight value
  highlightUnit?: string;  // Unit to append (e.g., "km", "min", "bpm")
  enabled: boolean;
  displayFields?: DisplayField[];  // Custom fields to display
}

/**
 * Plugin settings
 */
export interface CalendarPluginSettings {
  sources: CalendarSource[];
  defaultView: ViewMode;
  showWeekNumbers: boolean;
  startWeekOn: 'sunday' | 'monday';
}

/**
 * Available view modes
 */
export type ViewMode = 'month' | 'week' | 'list';

/**
 * Represents a calendar event extracted from a note
 */
export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  file: TFile;
  source: CalendarSource;
  metadata: Record<string, unknown>;
  imagePath?: string;  // Resolved image path (if available)
}

/**
 * Events grouped by date string (YYYY-MM-DD)
 */
export type EventsByDate = Map<string, CalendarEvent[]>;

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: CalendarPluginSettings = {
  sources: [
    {
      id: 'watched',
      name: 'Watched',
      folder: 'shows/watched',
      color: '#e74c3c',
      dateField: 'date',
      titleField: 'show',
      enabled: true,
      displayFields: [
        { field: 'type', label: '', format: 'none' },
        { field: 'episodeTitle', label: '', format: 'none' },
      ],
    },
    {
      id: 'workouts',
      name: 'Workouts',
      folder: 'health/workouts',
      color: '#f1c40f',
      dateField: 'date',
      titleField: 'workoutType',
      enabled: true,
      displayFields: [
        { field: 'totalTime', label: '', format: 'duration' },
        { field: 'distance', label: '', format: 'number', unitField: 'distanceUnit' },
      ],
    },
  ],
  defaultView: 'month',
  showWeekNumbers: false,
  startWeekOn: 'monday',
};

/**
 * Format a duration in minutes to hours and minutes
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Format a display field value
 */
export function formatFieldValue(
  value: unknown,
  field: DisplayField,
  metadata: Record<string, unknown>
): string {
  if (value === undefined || value === null) {
    return '';
  }

  let displayValue = '';
  const numValue = typeof value === 'number' ? value : parseFloat(String(value));

  switch (field.format) {
    case 'duration':
      if (!isNaN(numValue)) {
        displayValue = formatDuration(numValue);
      } else {
        displayValue = String(value);
      }
      break;
    case 'number':
      displayValue = String(value);
      break;
    default:
      // Extract display text from wikilinks
      displayValue = String(value);
      const linkMatch = displayValue.match(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/);
      if (linkMatch) {
        displayValue = linkMatch[1];
      }
  }

  // Add unit
  if (field.unitField && metadata[field.unitField]) {
    displayValue += ` ${metadata[field.unitField]}`;
  } else if (field.unit) {
    displayValue += ` ${field.unit}`;
  }

  // Add label
  if (field.label) {
    displayValue = `${field.label}: ${displayValue}`;
  }

  return displayValue;
}

/**
 * Generate a unique ID for new sources
 */
export function generateSourceId(): string {
  return 'source-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
