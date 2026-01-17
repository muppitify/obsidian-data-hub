import { CalendarEvent, CalendarPluginSettings, EventsByDate, formatFieldValue, formatDuration } from '../types';
import {
  formatDateKey,
  formatDisplayDate,
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getPreviousMonth,
  getNextMonth,
  formatMonthYear,
} from '../utils/dateUtils';

export interface ListViewOptions {
  currentDate: Date;
  settings: CalendarPluginSettings;
  eventsByDate: EventsByDate;
  onEventClick: (event: CalendarEvent) => void;
  onNavigate: (date: Date) => void;
  onToday: () => void;
  vaultAdapter?: { getResourcePath: (path: string) => string };
}

/**
 * Creates the list/agenda view
 */
export function createListView(options: ListViewOptions): HTMLElement {
  const {
    currentDate,
    settings,
    eventsByDate,
    onEventClick,
    onNavigate,
    onToday,
    vaultAdapter,
  } = options;

  const container = document.createElement('div');
  container.className = 'calendar-list-view';

  // Navigation header
  const header = createListHeader(currentDate, onNavigate, onToday);
  container.appendChild(header);

  // Get events for the current month
  const startDate = getFirstDayOfMonth(currentDate);
  const endDate = getLastDayOfMonth(currentDate);
  
  const eventsInMonth: Array<{ date: Date; events: CalendarEvent[] }> = [];
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const dateKey = formatDateKey(current);
    const events = eventsByDate.get(dateKey);
    if (events && events.length > 0) {
      eventsInMonth.push({
        date: new Date(current),
        events: [...events],
      });
    }
    current.setDate(current.getDate() + 1);
  }

  // Events list
  const list = container.createDiv('calendar-list-content');

  if (eventsInMonth.length === 0) {
    const empty = list.createDiv('calendar-list-empty');
    empty.textContent = 'No events this month';
  } else {
    eventsInMonth.forEach(({ date, events }) => {
      const dateGroup = createDateGroup(date, events, onEventClick, vaultAdapter);
      list.appendChild(dateGroup);
    });
  }

  // Summary
  const totalEvents = eventsInMonth.reduce((sum, { events }) => sum + events.length, 0);
  const summary = container.createDiv('calendar-list-summary');
  summary.textContent = `${totalEvents} event${totalEvents !== 1 ? 's' : ''} in ${formatMonthYear(currentDate)}`;

  // Legend
  const legend = createLegend(settings);
  container.appendChild(legend);

  return container;
}

/**
 * Create the list navigation header
 */
function createListHeader(
  currentDate: Date,
  onNavigate: (date: Date) => void,
  onToday: () => void
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'calendar-list-header';

  // Previous month button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'calendar-nav-btn calendar-nav-prev';
  prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  prevBtn.setAttribute('aria-label', 'Previous month');
  prevBtn.addEventListener('click', () => onNavigate(getPreviousMonth(currentDate)));
  header.appendChild(prevBtn);

  // Month title
  const title = document.createElement('h2');
  title.className = 'calendar-list-title';
  title.textContent = formatMonthYear(currentDate);
  header.appendChild(title);

  // Next month button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'calendar-nav-btn calendar-nav-next';
  nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  nextBtn.setAttribute('aria-label', 'Next month');
  nextBtn.addEventListener('click', () => onNavigate(getNextMonth(currentDate)));
  header.appendChild(nextBtn);

  // Today button
  const todayBtn = document.createElement('button');
  todayBtn.className = 'calendar-today-btn';
  todayBtn.textContent = 'Today';
  todayBtn.addEventListener('click', onToday);
  header.appendChild(todayBtn);

  return header;
}

/**
 * Create a date group with its events
 */
function createDateGroup(
  date: Date,
  events: CalendarEvent[],
  onEventClick: (event: CalendarEvent) => void,
  vaultAdapter?: { getResourcePath: (path: string) => string }
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'calendar-list-date-group';

  // Date header
  const dateHeader = group.createDiv('calendar-list-date-header');
  
  const dayName = dateHeader.createSpan('calendar-list-date-day');
  dayName.textContent = date.toLocaleDateString('en-US', { weekday: 'short' });
  
  const dayNum = dateHeader.createSpan('calendar-list-date-number');
  dayNum.textContent = String(date.getDate());

  const monthName = dateHeader.createSpan('calendar-list-date-month');
  monthName.textContent = date.toLocaleDateString('en-US', { month: 'short' });

  // Events
  const eventsContainer = group.createDiv('calendar-list-events');

  events.forEach(event => {
    const eventEl = createListEventItem(event, onEventClick, vaultAdapter);
    eventsContainer.appendChild(eventEl);
  });

  return group;
}

/**
 * Create an event item for the list view
 */
function createListEventItem(
  event: CalendarEvent,
  onClick: (event: CalendarEvent) => void,
  vaultAdapter?: { getResourcePath: (path: string) => string }
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'calendar-list-event';
  
  // Check for image (use resolved imagePath from scanner)
  const hasImage = !!event.imagePath;
  
  // Check for highlight field (supports comma-separated fallbacks)
  let highlightValue: unknown = undefined;
  let highlightFieldIndex = -1;
  if (event.source.highlightField) {
    const highlightFields = event.source.highlightField.split(',').map(f => f.trim()).filter(f => f);
    for (let i = 0; i < highlightFields.length; i++) {
      const field = highlightFields[i];
      if (event.metadata[field] !== undefined && event.metadata[field] !== null) {
        highlightValue = event.metadata[field];
        highlightFieldIndex = i;
        break;
      }
    }
  }
  const hasHighlight = !hasImage && highlightValue !== undefined && highlightValue !== null;
  
  // Get the corresponding unit (if units are comma-separated, match by index)
  let highlightUnit: string | undefined;
  if (event.source.highlightUnit && highlightFieldIndex >= 0) {
    const units = event.source.highlightUnit.split(',').map(u => u.trim());
    highlightUnit = units[highlightFieldIndex] || units[0];
  } else if (event.source.highlightUnit) {
    highlightUnit = event.source.highlightUnit.trim();
  }
  
  if (hasImage || hasHighlight) {
    item.addClass('has-image');
  }
  
  // Thumbnail image (if available)
  if (hasImage && vaultAdapter && event.imagePath) {
    const imageContainer = item.createDiv('calendar-list-event-image');
    const img = imageContainer.createEl('img');
    
    // Get the resource path for the image
    try {
      img.src = vaultAdapter.getResourcePath(event.imagePath);
      img.alt = event.title;
      img.onerror = () => {
        // Hide image container if image fails to load
        imageContainer.style.display = 'none';
        item.removeClass('has-image');
      };
    } catch (e) {
      imageContainer.style.display = 'none';
    }
  } else if (hasHighlight) {
    // Show highlight box instead of image
    const highlightBox = item.createDiv('calendar-list-event-highlight');
    highlightBox.style.backgroundColor = event.source.color;
    
    const format = event.source.highlightFormat || 'none';
    
    if (format === 'duration') {
      // For duration, show hours on top, minutes below
      const numValue = typeof highlightValue === 'number' ? highlightValue : parseFloat(String(highlightValue));
      if (!isNaN(numValue)) {
        const hours = Math.floor(numValue / 60);
        const mins = Math.round(numValue % 60);
        
        if (hours > 0) {
          const hoursEl = highlightBox.createDiv('calendar-highlight-hours');
          hoursEl.textContent = `${hours}h`;
        }
        const minsEl = highlightBox.createDiv('calendar-highlight-mins');
        minsEl.textContent = `${mins}m`;
      } else {
        const valueEl = highlightBox.createDiv('calendar-highlight-value');
        valueEl.textContent = String(highlightValue);
      }
    } else {
      // For other formats
      let displayValue = String(highlightValue);
      
      if (format === 'number') {
        const numValue = typeof highlightValue === 'number' ? highlightValue : parseFloat(String(highlightValue));
        if (!isNaN(numValue)) {
          displayValue = numValue.toLocaleString();
        }
      }
      
      const valueEl = highlightBox.createDiv('calendar-highlight-value');
      valueEl.textContent = displayValue;
      
      // Show unit below the number
      if (highlightUnit) {
        const unitEl = highlightBox.createDiv('calendar-highlight-unit');
        unitEl.textContent = highlightUnit;
      }
    }
  }
  
  // Color indicator
  const indicator = item.createDiv('calendar-list-event-indicator');
  indicator.style.backgroundColor = event.source.color;

  // Content
  const content = item.createDiv('calendar-list-event-content');
  
  const title = content.createDiv('calendar-list-event-title');
  title.textContent = event.title;

  const meta = content.createDiv('calendar-list-event-meta');
  
  // Show source
  const sourceBadge = meta.createSpan('calendar-list-event-source');
  sourceBadge.textContent = event.source.name;
  sourceBadge.style.backgroundColor = `${event.source.color}20`;
  sourceBadge.style.color = event.source.color;

  // Show configured display fields (stacked vertically)
  if (event.source.displayFields && event.source.displayFields.length > 0) {
    const fieldsContainer = content.createDiv('calendar-list-event-fields');
    event.source.displayFields.forEach(displayField => {
      const value = event.metadata[displayField.field];
      if (value !== undefined && value !== null) {
        const formatted = formatFieldValue(value, displayField, event.metadata);
        if (formatted) {
          const fieldRow = fieldsContainer.createDiv('calendar-list-event-field-row');
          fieldRow.textContent = formatted;
        }
      }
    });
  }

  // Click handler
  item.addEventListener('click', () => onClick(event));

  return item;
}

/**
 * Create the legend
 */
function createLegend(settings: CalendarPluginSettings): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'calendar-legend';

  settings.sources.filter(s => s.enabled).forEach(source => {
    const item = document.createElement('div');
    item.className = 'calendar-legend-item';
    
    const color = document.createElement('span');
    color.className = 'calendar-legend-color';
    color.style.backgroundColor = source.color;
    item.appendChild(color);

    const name = document.createElement('span');
    name.className = 'calendar-legend-name';
    name.textContent = source.name;
    item.appendChild(name);

    legend.appendChild(item);
  });

  return legend;
}
