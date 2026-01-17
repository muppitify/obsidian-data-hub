import { CalendarEvent, CalendarPluginSettings, EventsByDate } from '../types';
import { 
  formatMonthYear, 
  getMonthGridDates, 
  getWeekdayNames,
  getPreviousMonth,
  getNextMonth,
  formatDateKey,
  getWeekNumber
} from '../utils/dateUtils';
import { createDayCell, createEventList } from './DayCell';

export interface MonthGridOptions {
  currentDate: Date;
  settings: CalendarPluginSettings;
  eventsByDate: EventsByDate;
  onEventClick: (event: CalendarEvent) => void;
  onNavigate: (date: Date) => void;
  onToday: () => void;
}

/**
 * Creates the month grid view
 */
export function createMonthGrid(options: MonthGridOptions): HTMLElement {
  const {
    currentDate,
    settings,
    eventsByDate,
    onEventClick,
    onNavigate,
    onToday,
  } = options;

  const container = document.createElement('div');
  container.className = 'calendar-month-view';

  // Navigation header
  const header = createMonthHeader(currentDate, onNavigate, onToday);
  container.appendChild(header);

  // Weekday headers
  const weekdayRow = createWeekdayHeader(settings.startWeekOn, settings.showWeekNumbers);
  container.appendChild(weekdayRow);

  // Calendar grid
  const grid = document.createElement('div');
  grid.className = 'calendar-month-grid';
  if (settings.showWeekNumbers) {
    grid.addClass('show-week-numbers');
  }

  const dates = getMonthGridDates(currentDate, settings.startWeekOn);
  let selectedDate: Date | null = null;
  let eventListContainer: HTMLElement | null = null;

  // Track current week for week numbers
  let currentWeekStart = 0;

  dates.forEach((date, index) => {
    // Add week number at the start of each row
    if (settings.showWeekNumbers && index % 7 === 0) {
      const weekNum = document.createElement('div');
      weekNum.className = 'calendar-week-number';
      weekNum.textContent = String(getWeekNumber(date));
      grid.appendChild(weekNum);
    }

    const events = eventsByDate.get(formatDateKey(date)) || [];
    
    const cell = createDayCell({
      date,
      currentMonth: currentDate,
      events,
      selectedDate,
      onDayClick: (clickedDate, dayEvents) => {
        // Toggle selection
        if (selectedDate && formatDateKey(selectedDate) === formatDateKey(clickedDate)) {
          selectedDate = null;
          eventListContainer?.remove();
          eventListContainer = null;
          // Remove selection from all cells
          container.querySelectorAll('.calendar-day-cell.is-selected').forEach(el => {
            el.removeClass('is-selected');
          });
        } else {
          selectedDate = clickedDate;
          // Update selection visually
          container.querySelectorAll('.calendar-day-cell.is-selected').forEach(el => {
            el.removeClass('is-selected');
          });
          cell.addClass('is-selected');
          
          // Show event list
          eventListContainer?.remove();
          eventListContainer = createEventList(
            clickedDate,
            dayEvents,
            onEventClick,
            () => {
              selectedDate = null;
              eventListContainer?.remove();
              eventListContainer = null;
              cell.removeClass('is-selected');
            }
          );
          container.appendChild(eventListContainer);
        }
      },
      onEventClick,
    });

    grid.appendChild(cell);
  });

  container.appendChild(grid);

  // Legend
  const legend = createLegend(settings);
  container.appendChild(legend);

  return container;
}

/**
 * Create the month navigation header
 */
function createMonthHeader(
  currentDate: Date,
  onNavigate: (date: Date) => void,
  onToday: () => void
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'calendar-month-header';

  // Previous month button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'calendar-nav-btn calendar-nav-prev';
  prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  prevBtn.setAttribute('aria-label', 'Previous month');
  prevBtn.addEventListener('click', () => onNavigate(getPreviousMonth(currentDate)));
  header.appendChild(prevBtn);

  // Month/Year title
  const title = document.createElement('h2');
  title.className = 'calendar-month-title';
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
 * Create the weekday header row
 */
function createWeekdayHeader(startWeekOn: 'sunday' | 'monday', showWeekNumbers: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'calendar-weekday-header';
  if (showWeekNumbers) {
    row.addClass('show-week-numbers');
    // Empty cell for week number column
    const weekNumHeader = document.createElement('div');
    weekNumHeader.className = 'calendar-weekday-cell calendar-week-number-header';
    weekNumHeader.textContent = 'Wk';
    row.appendChild(weekNumHeader);
  }

  const weekdays = getWeekdayNames(startWeekOn);
  weekdays.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'calendar-weekday-cell';
    cell.textContent = day;
    row.appendChild(cell);
  });

  return row;
}

/**
 * Create the legend showing source colors
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
