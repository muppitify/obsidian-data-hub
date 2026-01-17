import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { CalendarPluginSettings, DEFAULT_SETTINGS } from './types';
import { CalendarSettingTab } from './settings';
import { NoteScanner } from './scanner';
import { CalendarView, VIEW_TYPE_CALENDAR } from './CalendarView';

export default class CalendarPlugin extends Plugin {
  settings: CalendarPluginSettings;
  scanner: NoteScanner;

  async onload(): Promise<void> {
    console.log('Loading Calendar Plugin');

    // Load settings
    await this.loadSettings();

    // Initialize scanner
    this.scanner = new NoteScanner(this.app);

    // Register the calendar view
    this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

    // Add ribbon icon
    this.addRibbonIcon('calendar', 'Open Calendar', () => {
      this.activateView();
    });

    // Add commands
    this.addCommand({
      id: 'open-calendar-view',
      name: 'Open calendar view',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'calendar-go-to-today',
      name: 'Go to today',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.goToToday();
        }
      },
    });

    this.addCommand({
      id: 'calendar-next-period',
      name: 'Next month/week',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.nextPeriod();
        }
      },
    });

    this.addCommand({
      id: 'calendar-previous-period',
      name: 'Previous month/week',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.previousPeriod();
        }
      },
    });

    this.addCommand({
      id: 'calendar-view-month',
      name: 'Switch to month view',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.setViewMode('month');
        }
      },
    });

    this.addCommand({
      id: 'calendar-view-week',
      name: 'Switch to week view',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.setViewMode('week');
        }
      },
    });

    this.addCommand({
      id: 'calendar-view-list',
      name: 'Switch to list view',
      callback: () => {
        const view = this.getCalendarView();
        if (view) {
          view.setViewMode('list');
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new CalendarSettingTab(this.app, this));

    // Listen for file changes to update the calendar
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.handleFileChange(file);
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.handleFileDelete(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          this.handleFileRename(file, oldPath);
        }
      })
    );

    // Initial scan when layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.scanner.scanSources(this.settings.sources);
    });
  }

  onunload(): void {
    console.log('Unloading Calendar Plugin');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Rescan sources when settings change
    await this.scanner.scanSources(this.settings.sources);
    // Refresh the view
    await this.refreshViewIfAvailable();
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new leaf in the main content area (as a new tab)
      leaf = workspace.getLeaf('tab');
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  getCalendarView(): CalendarView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
    if (leaves.length > 0) {
      return leaves[0].view as CalendarView;
    }
    return null;
  }

  private async refreshViewIfAvailable(): Promise<void> {
    const view = this.getCalendarView();
    if (view && typeof view.refresh === 'function') {
      await view.refresh();
    }
  }

  private async handleFileChange(file: TFile): Promise<void> {
    // Check if file is in a tracked folder
    const isTracked = this.settings.sources.some(
      s => s.enabled && file.path.startsWith(s.folder + '/')
    );

    if (isTracked) {
      await this.scanner.updateFile(file, this.settings.sources);
      await this.refreshViewIfAvailable();
    }
  }

  private async handleFileDelete(file: TFile): Promise<void> {
    this.scanner.removeEventForFile(file);
    await this.refreshViewIfAvailable();
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    // Remove old path and add new
    const oldFile = { path: oldPath } as TFile;
    this.scanner.removeEventForFile(oldFile);
    await this.scanner.updateFile(file, this.settings.sources);
    await this.refreshViewIfAvailable();
  }
}
