import { CalendarEvent, CalendarPluginSettings, EventsByDate, formatFieldValue } from '../types';
import {
  getWeekDates,
  getWeekdayNames,
  formatDateKey,
  isToday,
  getPreviousWeek,
  getNextWeek,
  formatDisplayDate,
} from '../utils/dateUtils';

export interface WeekViewOptions {
  currentDate: Date;
  settings: CalendarPluginSettings;
  eventsByDate: EventsByDate;
  onEventClick: (event: CalendarEvent) => void;
  onNavigate: (date: Date) => void;
  onToday: () => void;
}

/**
 * Creates the week view
 */
export function createWeekView(options: WeekViewOptions): HTMLElement {
  const {
    currentDate,
    settings,
    eventsByDate,
    onEventClick,
    onNavigate,
    onToday,
  } = options;

  const container = document.createElement('div');
  container.className = 'calendar-week-view';

  // Navigation header
  const header = createWeekHeader(currentDate, settings, onNavigate, onToday);
  container.appendChild(header);

  // Week grid
  const grid = document.createElement('div');
  grid.className = 'calendar-week-grid';

  const dates = getWeekDates(currentDate, settings.startWeekOn);

  dates.forEach(date => {
    const dayColumn = createDayColumn(date, eventsByDate, onEventClick);
    grid.appendChild(dayColumn);
  });

  container.appendChild(grid);

  // Legend
  const legend = createLegend(settings);
  container.appendChild(legend);

  return container;
}

/**
 * Create the week navigation header
 */
function createWeekHeader(
  currentDate: Date,
  settings: CalendarPluginSettings,
  onNavigate: (date: Date) => void,
  onToday: () => void
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'calendar-week-header';

  const dates = getWeekDates(currentDate, settings.startWeekOn);
  const startDate = dates[0];
  const endDate = dates[6];

  // Previous week button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'calendar-nav-btn calendar-nav-prev';
  prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  prevBtn.setAttribute('aria-label', 'Previous week');
  prevBtn.addEventListener('click', () => onNavigate(getPreviousWeek(currentDate)));
  header.appendChild(prevBtn);

  // Week title
  const title = document.createElement('h2');
  title.className = 'calendar-week-title';
  
  const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  title.textContent = `${startStr} - ${endStr}`;
  header.appendChild(title);

  // Next week button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'calendar-nav-btn calendar-nav-next';
  nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  nextBtn.setAttribute('aria-label', 'Next week');
  nextBtn.addEventListener('click', () => onNavigate(getNextWeek(currentDate)));
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
 * Create a day column for the week view
 */
function createDayColumn(
  date: Date,
  eventsByDate: EventsByDate,
  onEventClick: (event: CalendarEvent) => void
): HTMLElement {
  const column = document.createElement('div');
  column.className = 'calendar-week-day';
  
  if (isToday(date)) {
    column.addClass('is-today');
  }

  // Day header
  const header = column.createDiv('calendar-week-day-header');
  
  const dayName = header.createDiv('calendar-week-day-name');
  dayName.textContent = date.toLocaleDateString('en-US', { weekday: 'short' });
  
  const dayNum = header.createDiv('calendar-week-day-number');
  dayNum.textContent = String(date.getDate());
  if (isToday(date)) {
    dayNum.addClass('is-today');
  }

  // Events
  const events = eventsByDate.get(formatDateKey(date)) || [];
  const eventsContainer = column.createDiv('calendar-week-day-events');

  events.forEach(event => {
    const eventEl = createWeekEventItem(event, onEventClick);
    eventsContainer.appendChild(eventEl);
  });

  if (events.length === 0) {
    const empty = eventsContainer.createDiv('calendar-week-day-empty');
    empty.textContent = '-';
  }

  return column;
}

/**
 * Create an event item for the week view
 */
function createWeekEventItem(
  event: CalendarEvent,
  onClick: (event: CalendarEvent) => void
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'calendar-week-event';
  item.style.borderLeftColor = event.source.color;
  item.style.backgroundColor = `${event.source.color}15`;

  const title = item.createDiv('calendar-week-event-title');
  title.textContent = event.title;

  const meta = item.createDiv('calendar-week-event-source');
  
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
  
  meta.textContent = metaParts.join(' · ');

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
