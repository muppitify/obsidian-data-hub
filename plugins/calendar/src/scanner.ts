import { App, TFile, TFolder } from 'obsidian';
import { CalendarEvent, CalendarSource, EventsByDate } from './types';
import { formatDateKey, parseDateString } from './utils/dateUtils';

/**
 * Scans folders for notes with date frontmatter and creates calendar events
 */
export class NoteScanner {
  private app: App;
  private eventCache: Map<string, CalendarEvent[]> = new Map();
  private eventsByDate: EventsByDate = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Scan all configured sources and build the event cache
   */
  async scanSources(sources: CalendarSource[]): Promise<void> {
    this.eventCache.clear();
    this.eventsByDate.clear();

    const enabledSources = sources.filter(s => s.enabled);
    
    for (const source of enabledSources) {
      const events = await this.scanSource(source);
      this.eventCache.set(source.id, events);
      
      // Index events by date
      for (const event of events) {
        const dateKey = formatDateKey(event.date);
        const existing = this.eventsByDate.get(dateKey) || [];
        existing.push(event);
        this.eventsByDate.set(dateKey, existing);
      }
    }
  }

  /**
   * Scan a single source folder for events
   */
  private async scanSource(source: CalendarSource): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    const folder = this.app.vault.getAbstractFileByPath(source.folder);
    
    if (!folder || !(folder instanceof TFolder)) {
      console.warn(`Calendar: Folder not found: ${source.folder}`);
      return events;
    }

    const files = this.getMarkdownFilesInFolder(folder);
    
    for (const file of files) {
      const event = await this.createEventFromFile(file, source);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Get all markdown files in a folder (recursively)
   */
  private getMarkdownFilesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      } else if (child instanceof TFolder) {
        files.push(...this.getMarkdownFilesInFolder(child));
      }
    }
    
    return files;
  }

  /**
   * Create a calendar event from a file
   */
  private async createEventFromFile(file: TFile, source: CalendarSource): Promise<CalendarEvent | null> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    
    if (!frontmatter) {
      return null;
    }

    // Get the date from frontmatter
    const dateValue = frontmatter[source.dateField];
    if (!dateValue) {
      return null;
    }

    const date = parseDateString(String(dateValue));
    if (!date) {
      return null;
    }

    // Get the title
    let title = file.basename;
    if (source.titleField && frontmatter[source.titleField]) {
      const titleValue = frontmatter[source.titleField];
      // Handle wikilinks in title field
      if (typeof titleValue === 'string') {
        title = this.extractDisplayText(titleValue);
      } else if (Array.isArray(titleValue)) {
        title = titleValue.map(v => this.extractDisplayText(String(v))).join(', ');
      }
    }

    // Resolve image path
    let imagePath: string | undefined;
    if (source.imageField) {
      // First, check if the image is directly on this note
      if (frontmatter[source.imageField]) {
        imagePath = String(frontmatter[source.imageField]);
      }
      
      // If no direct image and we have linked note fields to check
      if (!imagePath && source.imageFromLinkedNote) {
        // Support comma-separated list of fields to try (e.g., "movie, show")
        const linkedFields = source.imageFromLinkedNote.split(',').map(f => f.trim()).filter(f => f);
        
        for (const linkedField of linkedFields) {
          if (frontmatter[linkedField]) {
            const linkedNotePath = this.resolveLink(frontmatter[linkedField], file.path);
            if (linkedNotePath) {
              const linkedFile = this.app.vault.getAbstractFileByPath(linkedNotePath);
              if (linkedFile instanceof TFile) {
                const linkedCache = this.app.metadataCache.getFileCache(linkedFile);
                if (linkedCache?.frontmatter?.[source.imageField]) {
                  imagePath = String(linkedCache.frontmatter[source.imageField]);
                  break; // Found an image, stop looking
                }
              }
            }
          }
        }
      }
    }

    return {
      id: file.path,
      title,
      date,
      file,
      source,
      metadata: { ...frontmatter },
      imagePath,
    };
  }

  /**
   * Resolve a wikilink to a file path
   */
  private resolveLink(linkValue: unknown, sourcePath: string): string | null {
    if (!linkValue) return null;
    
    const linkStr = String(linkValue);
    
    // Extract path from wikilink [[path]] or [[path|display]]
    const match = linkStr.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    const linkPath = match ? match[1] : linkStr;
    
    // Try to resolve the link
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    return linkedFile?.path || null;
  }

  /**
   * Extract display text from a wikilink or plain text
   */
  private extractDisplayText(text: string): string {
    // Handle [[link|display]] format
    const linkMatch = text.match(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/);
    if (linkMatch) {
      return linkMatch[1];
    }
    // Handle [[link]] format
    const simpleLinkMatch = text.match(/\[\[([^\]]+)\]\]/);
    if (simpleLinkMatch) {
      // Return the last part of the path if it's a path
      const parts = simpleLinkMatch[1].split('/');
      return parts[parts.length - 1];
    }
    return text;
  }

  /**
   * Get events for a specific date
   */
  getEventsForDate(date: Date): CalendarEvent[] {
    const dateKey = formatDateKey(date);
    return this.eventsByDate.get(dateKey) || [];
  }

  /**
   * Get events for a date range
   */
  getEventsInRange(startDate: Date, endDate: Date): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      events.push(...this.getEventsForDate(current));
      current.setDate(current.getDate() + 1);
    }
    
    return events;
  }

  /**
   * Get all events grouped by date
   */
  getEventsByDate(): EventsByDate {
    return this.eventsByDate;
  }

  /**
   * Get events for a specific source
   */
  getEventsForSource(sourceId: string): CalendarEvent[] {
    return this.eventCache.get(sourceId) || [];
  }

  /**
   * Update events when a file changes
   */
  async updateFile(file: TFile, sources: CalendarSource[]): Promise<void> {
    // Find which source this file belongs to
    const source = sources.find(s => s.enabled && file.path.startsWith(s.folder + '/'));
    
    if (!source) {
      return;
    }

    // Remove old event for this file
    this.removeEventForFile(file);

    // Create new event
    const event = await this.createEventFromFile(file, source);
    
    if (event) {
      // Add to source cache
      const sourceEvents = this.eventCache.get(source.id) || [];
      sourceEvents.push(event);
      this.eventCache.set(source.id, sourceEvents);
      
      // Add to date index
      const dateKey = formatDateKey(event.date);
      const dateEvents = this.eventsByDate.get(dateKey) || [];
      dateEvents.push(event);
      this.eventsByDate.set(dateKey, dateEvents);
    }
  }

  /**
   * Remove events for a deleted file
   */
  removeEventForFile(file: TFile): void {
    // Remove from all source caches
    for (const [sourceId, events] of this.eventCache) {
      const filtered = events.filter(e => e.file.path !== file.path);
      this.eventCache.set(sourceId, filtered);
    }
    
    // Remove from date index
    for (const [dateKey, events] of this.eventsByDate) {
      const filtered = events.filter(e => e.file.path !== file.path);
      if (filtered.length > 0) {
        this.eventsByDate.set(dateKey, filtered);
      } else {
        this.eventsByDate.delete(dateKey);
      }
    }
  }

  /**
   * Get count of events per date for a date range
   */
  getEventCountsInRange(startDate: Date, endDate: Date): Map<string, number> {
    const counts = new Map<string, number>();
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dateKey = formatDateKey(current);
      const events = this.eventsByDate.get(dateKey);
      if (events && events.length > 0) {
        counts.set(dateKey, events.length);
      }
      current.setDate(current.getDate() + 1);
    }
    
    return counts;
  }
}
