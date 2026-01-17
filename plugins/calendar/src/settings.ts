import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type CalendarPlugin from './main';
import { CalendarPluginSettings, CalendarSource, DisplayField, generateSourceId } from './types';
import { COLOR_PALETTE } from './utils/colorUtils';

export class CalendarSettingTab extends PluginSettingTab {
  plugin: CalendarPlugin;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Calendar View Settings' });

    // Refresh button
    new Setting(containerEl)
      .setName('Refresh calendar')
      .setDesc('Rescan all sources and reload the calendar view')
      .addButton(button => button
        .setButtonText('Refresh')
        .onClick(async () => {
          button.setButtonText('Refreshing...');
          button.setDisabled(true);
          await this.plugin.scanner.scanSources(this.plugin.settings.sources);
          const view = this.plugin.getCalendarView();
          if (view && typeof view.refresh === 'function') {
            await view.refresh();
          }
          button.setButtonText('Refresh');
          button.setDisabled(false);
          new Notice('Calendar refreshed');
        }));

    // Export/Import settings
    new Setting(containerEl)
      .setName('Export settings')
      .setDesc('Download your calendar sources and display fields as a JSON file')
      .addButton(button => button
        .setButtonText('Export')
        .onClick(() => {
          const settings = {
            sources: this.plugin.settings.sources,
            defaultView: this.plugin.settings.defaultView,
            showWeekNumbers: this.plugin.settings.showWeekNumbers,
            startWeekOn: this.plugin.settings.startWeekOn,
          };
          const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'calendar-settings.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          new Notice('Settings exported');
        }));

    new Setting(containerEl)
      .setName('Import settings')
      .setDesc('Load calendar sources and display fields from a JSON file')
      .addButton(button => button
        .setButtonText('Import')
        .onClick(() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            
            try {
              const text = await file.text();
              const imported = JSON.parse(text);
              
              // Validate the imported data
              if (!imported.sources || !Array.isArray(imported.sources)) {
                new Notice('Invalid settings file: missing sources');
                return;
              }
              
              // Merge imported settings
              this.plugin.settings.sources = imported.sources;
              if (imported.defaultView) this.plugin.settings.defaultView = imported.defaultView;
              if (imported.showWeekNumbers !== undefined) this.plugin.settings.showWeekNumbers = imported.showWeekNumbers;
              if (imported.startWeekOn) this.plugin.settings.startWeekOn = imported.startWeekOn;
              
              await this.plugin.saveSettings();
              this.display(); // Refresh the settings page
              new Notice('Settings imported successfully');
            } catch (err) {
              new Notice('Failed to import settings: ' + (err as Error).message);
            }
          };
          input.click();
        }));

    // General settings
    this.addGeneralSettings(containerEl);

    // Sources section
    containerEl.createEl('h3', { text: 'Calendar Sources' });
    containerEl.createEl('p', { 
      text: 'Configure folders to display on the calendar. Notes in these folders will be shown based on their date frontmatter field.',
      cls: 'setting-item-description'
    });

    // Add source button
    new Setting(containerEl)
      .setName('Add new source')
      .setDesc('Add a new folder to track on the calendar')
      .addButton(button => button
        .setButtonText('Add Source')
        .setCta()
        .onClick(async () => {
          const newSource: CalendarSource = {
            id: generateSourceId(),
            name: 'New Source',
            folder: '',
            color: COLOR_PALETTE[this.plugin.settings.sources.length % COLOR_PALETTE.length],
            dateField: 'date',
            enabled: true,
          };
          this.plugin.settings.sources.push(newSource);
          await this.plugin.saveSettings();
          this.display();
        }));

    // Existing sources
    const sourcesContainer = containerEl.createDiv('calendar-sources-container');
    this.plugin.settings.sources.forEach((source, index) => {
      this.addSourceSettings(sourcesContainer, source, index);
    });
  }

  private addGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Default view')
      .setDesc('Choose the default calendar view when opening')
      .addDropdown(dropdown => dropdown
        .addOption('month', 'Month')
        .addOption('week', 'Week')
        .addOption('list', 'List')
        .setValue(this.plugin.settings.defaultView)
        .onChange(async (value) => {
          this.plugin.settings.defaultView = value as CalendarPluginSettings['defaultView'];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Start week on')
      .setDesc('Choose which day the week starts on')
      .addDropdown(dropdown => dropdown
        .addOption('sunday', 'Sunday')
        .addOption('monday', 'Monday')
        .setValue(this.plugin.settings.startWeekOn)
        .onChange(async (value) => {
          this.plugin.settings.startWeekOn = value as 'sunday' | 'monday';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show week numbers')
      .setDesc('Display week numbers in the calendar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showWeekNumbers)
        .onChange(async (value) => {
          this.plugin.settings.showWeekNumbers = value;
          await this.plugin.saveSettings();
        }));
  }

  private addSourceSettings(containerEl: HTMLElement, source: CalendarSource, index: number): void {
    const sourceContainer = containerEl.createDiv('calendar-source-item');
    sourceContainer.style.border = '1px solid var(--background-modifier-border)';
    sourceContainer.style.borderRadius = '8px';
    sourceContainer.style.padding = '12px';
    sourceContainer.style.marginBottom = '12px';
    sourceContainer.style.borderLeft = `4px solid ${source.color}`;

    // Header with toggle and delete
    const headerSetting = new Setting(sourceContainer)
      .setName(source.name || 'Unnamed Source')
      .addToggle(toggle => toggle
        .setValue(source.enabled)
        .setTooltip('Enable/disable this source')
        .onChange(async (value) => {
          source.enabled = value;
          await this.plugin.saveSettings();
        }))
      .addExtraButton(button => button
        .setIcon('trash')
        .setTooltip('Delete source')
        .onClick(async () => {
          this.plugin.settings.sources.splice(index, 1);
          await this.plugin.saveSettings();
          this.display();
        }));

    // Name
    new Setting(sourceContainer)
      .setName('Name')
      .setDesc('Display name for this source')
      .addText(text => text
        .setPlaceholder('e.g., Watched')
        .setValue(source.name)
        .onChange(async (value) => {
          source.name = value;
          headerSetting.setName(value || 'Unnamed Source');
          await this.plugin.saveSettings();
        }));

    // Folder
    new Setting(sourceContainer)
      .setName('Folder')
      .setDesc('Path to the folder containing notes')
      .addText(text => text
        .setPlaceholder('e.g., shows/watched')
        .setValue(source.folder)
        .onChange(async (value) => {
          source.folder = value;
          await this.plugin.saveSettings();
        }));

    // Color
    new Setting(sourceContainer)
      .setName('Color')
      .setDesc('Color for events from this source')
      .addColorPicker(picker => picker
        .setValue(source.color)
        .onChange(async (value) => {
          source.color = value;
          sourceContainer.style.borderLeft = `4px solid ${value}`;
          await this.plugin.saveSettings();
        }))
      .addDropdown(dropdown => {
        COLOR_PALETTE.forEach((color, i) => {
          dropdown.addOption(color, `Preset ${i + 1}`);
        });
        dropdown.setValue(source.color);
        dropdown.onChange(async (value) => {
          source.color = value;
          sourceContainer.style.borderLeft = `4px solid ${value}`;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // Date field
    new Setting(sourceContainer)
      .setName('Date field')
      .setDesc('Frontmatter field containing the date')
      .addText(text => text
        .setPlaceholder('date')
        .setValue(source.dateField)
        .onChange(async (value) => {
          source.dateField = value || 'date';
          await this.plugin.saveSettings();
        }));

    // Title field (optional)
    new Setting(sourceContainer)
      .setName('Title field (optional)')
      .setDesc('Frontmatter field to use as event title (defaults to filename)')
      .addText(text => text
        .setPlaceholder('e.g., show, workoutType')
        .setValue(source.titleField || '')
        .onChange(async (value) => {
          source.titleField = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Image field (optional)
    new Setting(sourceContainer)
      .setName('Image field (optional)')
      .setDesc('Frontmatter field containing image path (for list view thumbnails)')
      .addText(text => text
        .setPlaceholder('e.g., cover, localCoverImage, poster')
        .setValue(source.imageField || '')
        .onChange(async (value) => {
          source.imageField = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Image from linked note (optional)
    new Setting(sourceContainer)
      .setName('Image from linked note (optional)')
      .setDesc('If image is on a linked note, specify link field(s) to try. Use comma-separated values to try multiple fields (e.g., "movie, show"). First match wins.')
      .addText(text => text
        .setPlaceholder('e.g., movie, show')
        .setValue(source.imageFromLinkedNote || '')
        .onChange(async (value) => {
          source.imageFromLinkedNote = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Highlight field (shows a value in a box when no image)
    new Setting(sourceContainer)
      .setName('Highlight field (optional)')
      .setDesc('Show this field in a colored box (same size as thumbnails). Use comma-separated values for fallbacks (e.g., "timeAsleep, restingHeartRate"). First available value wins.')
      .addText(text => text
        .setPlaceholder('e.g., timeAsleep, restingHeartRate')
        .setValue(source.highlightField || '')
        .onChange(async (value) => {
          source.highlightField = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Highlight format (always show)
    new Setting(sourceContainer)
      .setName('Highlight format')
      .setDesc('How to format the highlight value')
      .addDropdown(dropdown => dropdown
        .addOption('none', 'None (as-is)')
        .addOption('duration', 'Duration (minutes → Xh Ym)')
        .addOption('number', 'Number')
        .setValue(source.highlightFormat || 'none')
        .onChange(async (value) => {
          source.highlightFormat = value as 'none' | 'duration' | 'number';
          await this.plugin.saveSettings();
        }));

    // Highlight unit
    new Setting(sourceContainer)
      .setName('Highlight unit (optional)')
      .setDesc('Unit to append. Use comma-separated values to match highlight fields (e.g., "km, min" matches "distance, totalTime")')
      .addText(text => text
        .setPlaceholder('e.g., km, min')
        .setValue(source.highlightUnit || '')
        .onChange(async (value) => {
          source.highlightUnit = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Display fields section
    const displayFieldsContainer = sourceContainer.createDiv('calendar-display-fields');
    displayFieldsContainer.createEl('h4', { text: 'Display Fields', cls: 'calendar-display-fields-title' });
    
    const displayFieldsDesc = displayFieldsContainer.createEl('p', { 
      text: 'Configure additional fields to show in calendar events',
      cls: 'setting-item-description'
    });

    // Initialize displayFields if not present
    if (!source.displayFields) {
      source.displayFields = [];
    }

    // Add display field button
    new Setting(displayFieldsContainer)
      .addButton(button => button
        .setButtonText('Add Display Field')
        .onClick(async () => {
          source.displayFields = source.displayFields || [];
          source.displayFields.push({
            field: '',
            label: '',
            format: 'none',
          });
          await this.plugin.saveSettings();
          this.display();
        }));

    // Existing display fields
    source.displayFields.forEach((displayField, fieldIndex) => {
      this.addDisplayFieldSettings(displayFieldsContainer, source, displayField, fieldIndex);
    });

    // Move up/down buttons
    if (this.plugin.settings.sources.length > 1) {
      const moveContainer = new Setting(sourceContainer)
        .setName('Reorder')
        .setDesc('Change the display order');
      
      if (index > 0) {
        moveContainer.addExtraButton(button => button
          .setIcon('arrow-up')
          .setTooltip('Move up')
          .onClick(async () => {
            const temp = this.plugin.settings.sources[index - 1];
            this.plugin.settings.sources[index - 1] = source;
            this.plugin.settings.sources[index] = temp;
            await this.plugin.saveSettings();
            this.display();
          }));
      }
      
      if (index < this.plugin.settings.sources.length - 1) {
        moveContainer.addExtraButton(button => button
          .setIcon('arrow-down')
          .setTooltip('Move down')
          .onClick(async () => {
            const temp = this.plugin.settings.sources[index + 1];
            this.plugin.settings.sources[index + 1] = source;
            this.plugin.settings.sources[index] = temp;
            await this.plugin.saveSettings();
            this.display();
          }));
      }
    }
  }

  private addDisplayFieldSettings(
    containerEl: HTMLElement,
    source: CalendarSource,
    displayField: DisplayField,
    index: number
  ): void {
    const fieldContainer = containerEl.createDiv('calendar-display-field-item');
    fieldContainer.style.padding = '8px';
    fieldContainer.style.marginBottom = '8px';
    fieldContainer.style.background = 'var(--background-secondary)';
    fieldContainer.style.borderRadius = '4px';

    // Field name and delete button on same row
    const headerRow = new Setting(fieldContainer)
      .setName(`Field ${index + 1}`)
      .addExtraButton(button => button
        .setIcon('trash')
        .setTooltip('Remove field')
        .onClick(async () => {
          source.displayFields?.splice(index, 1);
          await this.plugin.saveSettings();
          this.display();
        }));

    // Field name
    new Setting(fieldContainer)
      .setName('Field name')
      .setDesc('Frontmatter field (e.g., timeAsleep, restingHeartRate)')
      .addText(text => text
        .setPlaceholder('fieldName')
        .setValue(displayField.field)
        .onChange(async (value) => {
          displayField.field = value;
          await this.plugin.saveSettings();
        }));

    // Label
    new Setting(fieldContainer)
      .setName('Label')
      .setDesc('Display label (leave empty to show just the value)')
      .addText(text => text
        .setPlaceholder('e.g., Sleep, Resting HR')
        .setValue(displayField.label)
        .onChange(async (value) => {
          displayField.label = value;
          await this.plugin.saveSettings();
        }));

    // Format
    new Setting(fieldContainer)
      .setName('Format')
      .setDesc('How to format the value')
      .addDropdown(dropdown => dropdown
        .addOption('none', 'None (text as-is)')
        .addOption('duration', 'Duration (minutes → Xh Ym)')
        .addOption('number', 'Number')
        .setValue(displayField.format)
        .onChange(async (value) => {
          displayField.format = value as DisplayField['format'];
          await this.plugin.saveSettings();
        }));

    // Unit field or static unit
    new Setting(fieldContainer)
      .setName('Unit')
      .setDesc('Unit to append (or field name containing the unit)')
      .addText(text => text
        .setPlaceholder('e.g., bpm or restingHeartRateUnit')
        .setValue(displayField.unit || displayField.unitField || '')
        .onChange(async (value) => {
          // If it looks like a field name (no spaces, letters only), treat as unitField
          if (value && /^[a-zA-Z][a-zA-Z0-9]*$/.test(value) && value.toLowerCase().includes('unit')) {
            displayField.unitField = value;
            displayField.unit = undefined;
          } else {
            displayField.unit = value || undefined;
            displayField.unitField = undefined;
          }
          await this.plugin.saveSettings();
        }));
  }
}
