# Obsidian Data Hub

Scripts, extensions, and plugins for building a personal data hub in Obsidian.

This is the code behind my [Personal Data Hub](https://sphere.muppit.au/applications/data-hub/) documentation. It tracks books, shows, health metrics, and workouts — all stored locally as markdown files with no cloud dependencies.

## What's included

### QuickAdd Scripts (`scripts/`)

JavaScript scripts for the [QuickAdd](https://github.com/chhoumann/quickadd) plugin:

| Script | Purpose |
|--------|---------|
| `add-book-google.js` | Search Google Books, create book note with cover |
| `add-show-tmdb.js` | Search TMDB, create movie/series notes |
| `log-watch.js` | Log a watch session for a show |
| `import-books-csv.js` | Batch import books from CSV |
| `import-emby-csv.js` | Import watch history from Emby |
| `import-health-csv.js` | Import Apple Health metrics |
| `import-workouts-csv.js` | Import workout data |
| `vault-tracker.js` | Track vault statistics |
| `sync-vault-tracker.js` | Sync tracker data |

### Chrome Extensions (`extensions/`)

Browser extensions for capturing watch history:

| Extension | Purpose |
|-----------|---------|
| `netflix-direct` | Scrape Netflix history, send directly to Obsidian vault |
| `prime-direct` | Scrape Prime Video history, send directly to Obsidian vault |
| `prime-csv` | Export Prime Video history as CSV |

These extensions use Obsidian's [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin to write directly to your vault.

### Obsidian Plugins (`plugins/`)

| Plugin | Purpose |
|--------|---------|
| `calendar` | Custom calendar view showing daily activity across domains |

## Requirements

- [Obsidian](https://obsidian.md/)
- [QuickAdd](https://github.com/chhoumann/quickadd) plugin (for scripts)
- [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin (for Chrome extensions)

### API keys (optional)

Some scripts require API keys stored in `.obsidian/quickadd-secrets.json`:

```json
{
  "googleBooksApiKey": "your-key",
  "tmdbApiKey": "your-key"
}
```

## iOS compatibility

All QuickAdd scripts work on iOS. They use `obsidian.requestUrl()` instead of `fetch()` and avoid Node.js APIs.

## Philosophy

- **Local-first**: Everything runs on your machine, no cloud services required
- **Plain text**: All data stored as markdown files you own forever
- **Privacy**: Your reading habits, health data, and watch history stay private

## Documentation

Full documentation with setup guides and architecture diagrams:  
https://sphere.muppit.au/applications/data-hub/

## Author

Built by [Muppit](https://sphere.muppit.au/muppit/) — local first, purpose driven.

## Licence

MIT
