import { ItemView, WorkspaceLeaf } from 'obsidian';
import type CalendarPlugin from './main';
import { CalendarEvent, ViewMode } from './types';
import { createMonthGrid } from './components/MonthGrid';
import { createWeekView } from './components/WeekView';
import { createListView } from './components/ListView';

export const VIEW_TYPE_CALENDAR = 'calendar-view';

export class CalendarView extends ItemView {
  plugin: CalendarPlugin;
  currentDate: Date;
  viewMode: ViewMode;
  containerEl: HTMLElement;
  private keydownHandler: (e: KeyboardEvent) => void;
  private visibleSources: Set<string>; // Track which sources are visible

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentDate = new Date();
    this.viewMode = plugin.settings.defaultView;
    this.visibleSources = new Set(); // Will be initialized in onOpen
    
    // Bind keyboard handler
    this.keydownHandler = this.handleKeydown.bind(this);
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return 'Calendar';
  }

  getIcon(): string {
    return 'calendar';
  }

  async onOpen(): Promise<void> {
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass('calendar-view-container');
    
    // Initialize visible sources with all enabled sources
    this.visibleSources = new Set(
      this.plugin.settings.sources
        .filter(s => s.enabled)
        .map(s => s.id)
    );
    
    // Add keyboard listener
    this.containerEl.addEventListener('keydown', this.keydownHandler);
    this.containerEl.setAttribute('tabindex', '0');

    await this.render();
  }

  async onClose(): Promise<void> {
    this.containerEl.removeEventListener('keydown', this.keydownHandler);
    this.containerEl.empty();
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Don't handle if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.previousPeriod();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.nextPeriod();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        this.goToToday();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        this.setViewMode('month');
        break;
      case 'w':
      case 'W':
        e.preventDefault();
        this.setViewMode('week');
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        this.setViewMode('list');
        break;
    }
  }

  async render(): Promise<void> {
    this.containerEl.empty();

    // View mode tabs
    const viewTabs = this.createViewTabs();
    this.containerEl.appendChild(viewTabs);

    // Source filter
    const filterBar = this.createFilterBar();
    this.containerEl.appendChild(filterBar);

    // Main content area
    const content = document.createElement('div');
    content.className = 'calendar-content';

    // Get events and filter by visible sources
    const allEventsByDate = this.plugin.scanner.getEventsByDate();
    const eventsByDate = this.filterEventsBySource(allEventsByDate);

    switch (this.viewMode) {
      case 'month':
        const monthView = createMonthGrid({
          currentDate: this.currentDate,
          settings: this.plugin.settings,
          eventsByDate,
          onEventClick: (event) => this.openEvent(event),
          onNavigate: (date) => this.navigateTo(date),
          onToday: () => this.goToToday(),
        });
        content.appendChild(monthView);
        break;

      case 'week':
        const weekView = createWeekView({
          currentDate: this.currentDate,
          settings: this.plugin.settings,
          eventsByDate,
          onEventClick: (event) => this.openEvent(event),
          onNavigate: (date) => this.navigateTo(date),
          onToday: () => this.goToToday(),
        });
        content.appendChild(weekView);
        break;

      case 'list':
        const listView = createListView({
          currentDate: this.currentDate,
          settings: this.plugin.settings,
          eventsByDate,
          onEventClick: (event) => this.openEvent(event),
          onNavigate: (date) => this.navigateTo(date),
          onToday: () => this.goToToday(),
          vaultAdapter: {
            getResourcePath: (path: string) => this.app.vault.adapter.getResourcePath(path),
          },
        });
        content.appendChild(listView);
        break;
    }

    this.containerEl.appendChild(content);
  }

  private createViewTabs(): HTMLElement {
    const tabs = document.createElement('div');
    tabs.className = 'calendar-view-tabs';

    const modes: { id: ViewMode; label: string }[] = [
      { id: 'month', label: 'Month' },
      { id: 'week', label: 'Week' },
      { id: 'list', label: 'List' },
    ];

    modes.forEach(mode => {
      const tab = document.createElement('button');
      tab.className = 'calendar-view-tab';
      if (mode.id === this.viewMode) {
        tab.addClass('is-active');
      }
      tab.textContent = mode.label;
      tab.addEventListener('click', () => {
        this.viewMode = mode.id;
        this.render();
      });
      tabs.appendChild(tab);
    });

    return tabs;
  }

  private createFilterBar(): HTMLElement {
    const filterBar = document.createElement('div');
    filterBar.className = 'calendar-filter-bar';

    const enabledSources = this.plugin.settings.sources.filter(s => s.enabled);

    // "All" toggle button
    const allBtn = document.createElement('button');
    allBtn.className = 'calendar-filter-btn calendar-filter-all';
    if (this.visibleSources.size === enabledSources.length) {
      allBtn.addClass('is-active');
    }
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
      if (this.visibleSources.size === enabledSources.length) {
        // Deselect all
        this.visibleSources.clear();
      } else {
        // Select all
        enabledSources.forEach(s => this.visibleSources.add(s.id));
      }
      this.render();
    });
    filterBar.appendChild(allBtn);

    // Individual source toggle buttons
    enabledSources.forEach(source => {
      const btn = document.createElement('button');
      btn.className = 'calendar-filter-btn';
      
      const isVisible = this.visibleSources.has(source.id);
      if (isVisible) {
        btn.addClass('is-active');
        btn.style.backgroundColor = source.color;
        btn.style.borderColor = source.color;
        btn.style.color = 'white';
      } else {
        btn.style.borderColor = source.color;
        btn.style.color = source.color;
      }
      
      btn.textContent = source.name;
      btn.addEventListener('click', () => {
        if (this.visibleSources.has(source.id)) {
          this.visibleSources.delete(source.id);
        } else {
          this.visibleSources.add(source.id);
        }
        this.render();
      });
      filterBar.appendChild(btn);
    });

    return filterBar;
  }

  private filterEventsBySource(eventsByDate: Map<string, CalendarEvent[]>): Map<string, CalendarEvent[]> {
    const filtered = new Map<string, CalendarEvent[]>();
    
    for (const [dateKey, events] of eventsByDate) {
      const filteredEvents = events.filter(e => this.visibleSources.has(e.source.id));
      if (filteredEvents.length > 0) {
        filtered.set(dateKey, filteredEvents);
      }
    }
    
    return filtered;
  }

  private async openEvent(event: CalendarEvent): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(event.file);
  }

  navigateTo(date: Date): void {
    this.currentDate = date;
    this.render();
  }

  goToToday(): void {
    this.currentDate = new Date();
    this.render();
  }

  nextPeriod(): void {
    if (this.viewMode === 'month') {
      this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1);
    } else {
      this.currentDate = new Date(this.currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    this.render();
  }

  previousPeriod(): void {
    if (this.viewMode === 'month') {
      this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
    } else {
      this.currentDate = new Date(this.currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    this.render();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }
}
