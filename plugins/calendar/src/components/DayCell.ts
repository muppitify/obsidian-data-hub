import { CalendarEvent, formatFieldValue } from '../types';
import { isToday, isSameDay, formatDateKey } from '../utils/dateUtils';
import { addAlpha } from '../utils/colorUtils';

export interface DayCellOptions {
  date: Date;
  currentMonth: Date;
  events: CalendarEvent[];
  showWeekNumber?: boolean;
  weekNumber?: number;
  onDayClick?: (date: Date, events: CalendarEvent[]) => void;
  onEventClick?: (event: CalendarEvent) => void;
  selectedDate?: Date | null;
}

/**
 * Renders a single day cell in the calendar grid
 */
export function createDayCell(options: DayCellOptions): HTMLElement {
  const {
    date,
    currentMonth,
    events,
    onDayClick,
    onEventClick,
    selectedDate,
  } = options;

  const cell = document.createElement('div');
  cell.className = 'calendar-day-cell';
  cell.setAttribute('data-date', formatDateKey(date));

  // Add appropriate classes
  if (isToday(date)) {
    cell.addClass('is-today');
  }
  if (date.getMonth() !== currentMonth.getMonth()) {
    cell.addClass('is-other-month');
  }
  if (selectedDate && isSameDay(date, selectedDate)) {
    cell.addClass('is-selected');
  }
  if (events.length > 0) {
    cell.addClass('has-events');
  }

  // Day number
  const dayNumber = cell.createDiv('calendar-day-number');
  dayNumber.textContent = String(date.getDate());

  // Events container
  if (events.length > 0) {
    const eventsContainer = cell.createDiv('calendar-day-events');
    
    // Show up to 3 events, then a "+N more" indicator
    const maxVisible = 3;
    const visibleEvents = events.slice(0, maxVisible);
    
    visibleEvents.forEach(event => {
      const eventEl = createEventDot(event, onEventClick);
      eventsContainer.appendChild(eventEl);
    });

    if (events.length > maxVisible) {
      const moreEl = document.createElement('div');
      moreEl.className = 'calendar-event-more';
      moreEl.textContent = `+${events.length - maxVisible}`;
      eventsContainer.appendChild(moreEl);
    }
  }

  // Click handler for the cell
  if (onDayClick) {
    cell.addEventListener('click', (e) => {
      // Don't trigger day click if clicking on an event
      if ((e.target as HTMLElement).closest('.calendar-event-dot')) {
        return;
      }
      onDayClick(date, events);
    });
  }

  return cell;
}

/**
 * Create an event dot/badge
 */
function createEventDot(event: CalendarEvent, onClick?: (event: CalendarEvent) => void): HTMLElement {
  const dot = document.createElement('div');
  dot.className = 'calendar-event-dot';
  dot.style.backgroundColor = event.source.color;
  dot.setAttribute('title', event.title);
  dot.setAttribute('data-source', event.source.id);
  
  // Add a small text snippet for larger views
  const text = document.createElement('span');
  text.className = 'calendar-event-text';
  text.textContent = event.title;
  dot.appendChild(text);

  if (onClick) {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(event);
    });
  }

  return dot;
}

/**
 * Create the expanded event list for a selected day
 */
export function createEventList(
  date: Date,
  events: CalendarEvent[],
  onEventClick?: (event: CalendarEvent) => void,
  onClose?: () => void
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'calendar-event-list';

  // Header
  const header = container.createDiv('calendar-event-list-header');
  
  const title = header.createEl('h4');
  title.textContent = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (onClose) {
    const closeBtn = header.createEl('button', { cls: 'calendar-event-list-close' });
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', onClose);
  }

  // Events
  if (events.length === 0) {
    const empty = container.createDiv('calendar-event-list-empty');
    empty.textContent = 'No events on this day';
  } else {
    const list = container.createDiv('calendar-event-list-items');
    
    // Group events by source
    const bySource = new Map<string, CalendarEvent[]>();
    events.forEach(event => {
      const sourceEvents = bySource.get(event.source.id) || [];
      sourceEvents.push(event);
      bySource.set(event.source.id, sourceEvents);
    });

    bySource.forEach((sourceEvents, sourceId) => {
      const source = sourceEvents[0].source;
      
      sourceEvents.forEach(event => {
        const item = createEventListItem(event, onEventClick);
        list.appendChild(item);
      });
    });
  }

  return container;
}

/**
 * Create a single event list item
 */
function createEventListItem(
  event: CalendarEvent,
  onClick?: (event: CalendarEvent) => void
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'calendar-event-list-item';
  
  // Color indicator
  const indicator = item.createDiv('calendar-event-indicator');
  indicator.style.backgroundColor = event.source.color;

  // Content
  const content = item.createDiv('calendar-event-content');
  
  const title = content.createDiv('calendar-event-title');
  title.textContent = event.title;

  // Build meta string from configured display fields
  const metaParts: string[] = [event.source.name];
  
  if (event.source.displayFields) {
    event.source.displayFields.forEach(displayField => {
      const value = event.metadata[displayField.field];
      if (value !== undefined && value !== null) {
        const formatted = formatFieldValue(value, displayField, event.metadata);
        if (formatted) {
          metaParts.push(formatted);
        }
      }
    });
  }

  const meta = content.createDiv('calendar-event-meta');
  meta.textContent = metaParts.join(' · ');

  // Click handler
  if (onClick) {
    item.addEventListener('click', () => onClick(event));
    item.addClass('is-clickable');
  }

  return item;
}

/**
 * Create a hover tooltip for an event
 */
export function createEventTooltip(event: CalendarEvent): HTMLElement {
  const tooltip = document.createElement('div');
  tooltip.className = 'calendar-event-tooltip';

  // Title
  const title = tooltip.createDiv('calendar-tooltip-title');
  title.textContent = event.title;

  // Source badge
  const badge = tooltip.createDiv('calendar-tooltip-badge');
  badge.style.backgroundColor = addAlpha(event.source.color, 0.2);
  badge.style.color = event.source.color;
  badge.textContent = event.source.name;

  // Metadata preview
  const meta = tooltip.createDiv('calendar-tooltip-meta');
  
  // Show relevant metadata based on source
  const relevantFields = ['type', 'workoutType', 'totalTime', 'distance', 'season', 'episodeNum'];
  relevantFields.forEach(field => {
    if (event.metadata[field] !== undefined) {
      const row = meta.createDiv('calendar-tooltip-meta-row');
      row.createSpan({ text: field + ': ', cls: 'calendar-tooltip-label' });
      row.createSpan({ text: String(event.metadata[field]) });
    }
  });

  // File path hint
  const path = tooltip.createDiv('calendar-tooltip-path');
  path.textContent = event.file.path;

  return tooltip;
}
