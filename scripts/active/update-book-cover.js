// Update Book Cover - QuickAdd Script for Obsidian
// ================================================
// Updates or adds a cover image to an existing book note.
//
// Usage:
//   1. Open a book note in Obsidian
//   2. Run this script via QuickAdd
//   3. Choose an option:
//      - Download from URL (paste direct image URL)
//      - Select from covers folder (pick from books/covers, renames to match book title)
//      - Search Google Books (find cover by title)
//      - Search Apple Books (find cover by title)
//
// The script will download the image and update the localCoverImage frontmatter.
// iOS compatible: uses obsidian.requestUrl() from params

const SETTINGS = {
  coverFolder: "books/covers",  // Match main add-book-google.js script
};

module.exports = {
  entry: start,
  settings: {
    name: "Update Book Cover",
    author: "QuickAdd Script",
    options: {},
  },
};

async function start(params, settings) {
  const { app, obsidian, quickAddApi: qa } = params;
  const Notice = obsidian?.Notice;

  // Get the active file
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    if (Notice) new Notice("No file is currently open.");
    return;
  }

  if (activeFile.extension !== "md") {
    if (Notice) new Notice("Active file is not a markdown file.");
    return;
  }

  // Check it's a book note (has title in frontmatter)
  const cache = app.metadataCache.getFileCache(activeFile);
  const fm = cache?.frontmatter;
  if (!fm?.title) {
    if (Notice) new Notice("This doesn't appear to be a book note (no title in frontmatter).");
    return;
  }

  const bookTitle = fm.title;
  const currentCover = fm.localCoverImage || "";

  // Show current cover status
  const status = currentCover ? `Current cover: ${currentCover}` : "No cover image set";

  // Ask what to do
  const action = await qa.suggester(
    [
      "Download from URL",
      "Select from covers folder (rename & link)",
      "Search Google Books for cover",
      "Search Apple Books for cover",
      "Cancel",
    ],
    ["url", "vault", "google", "apple", "cancel"]
  );

  if (action === "cancel" || !action) return;

  let newCoverPath = null;

  if (action === "url") {
    const url = await qa.inputPrompt("Cover Image URL", "Paste the full URL to the cover image");
    if (!url || !url.trim()) return;

    newCoverPath = await downloadCover(app, obsidian, url.trim(), bookTitle);
    if (!newCoverPath) {
      if (Notice) new Notice("Failed to download cover image.");
      return;
    }
  } else if (action === "vault") {
    // Get image files from books/covers folder only
    const coverFolder = SETTINGS.coverFolder;
    const imageFiles = app.vault.getFiles().filter((f) => {
      const ext = f.extension?.toLowerCase();
      const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
      const inCoverFolder = f.path.startsWith(coverFolder + "/");
      return isImage && inCoverFolder;
    });

    if (imageFiles.length === 0) {
      if (Notice) new Notice(`No image files found in ${coverFolder}/`);
      return;
    }

    // Sort by modification time (newest first) to show recent additions at top
    imageFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

    const selected = await qa.suggester(
      imageFiles.map((f) => f.name),  // Show just filename, not full path
      imageFiles
    );

    if (!selected) return;

    // Rename the file to match book title
    const ext = selected.extension;
    const safeName = safeFilename(bookTitle) || "cover";
    const newFilename = `${safeName}.${ext}`;
    const newPath = `${coverFolder}/${newFilename}`;

    // Check if rename is needed
    if (selected.path !== newPath) {
      // Check if target already exists
      if (await app.vault.adapter.exists(newPath)) {
        // Generate unique name
        let counter = 1;
        let uniquePath = newPath;
        while (await app.vault.adapter.exists(uniquePath)) {
          uniquePath = `${coverFolder}/${safeName}-${counter}.${ext}`;
          counter++;
        }
        await app.fileManager.renameFile(selected, uniquePath);
        newCoverPath = uniquePath;
        if (Notice) new Notice(`Renamed to: ${uniquePath.split("/").pop()}`);
      } else {
        await app.fileManager.renameFile(selected, newPath);
        newCoverPath = newPath;
        if (Notice) new Notice(`Renamed to: ${newFilename}`);
      }
    } else {
      newCoverPath = selected.path;
    }
  } else if (action === "google") {
    // Search Google Books for this title
    const searchTerm = await qa.inputPrompt("Search Google Books", bookTitle);
    if (!searchTerm || !searchTerm.trim()) return;

    if (Notice) new Notice("Searching Google Books...");
    const results = await searchGoogleBooks(obsidian, searchTerm.trim());
    if (!results || results.length === 0) {
      if (Notice) new Notice("No results found on Google Books.");
      return;
    }

    // Filter to only books with covers
    const withCovers = results.filter((r) => r.coverUrl);
    if (withCovers.length === 0) {
      if (Notice) new Notice("No covers found in search results.");
      return;
    }

    // Let user pick
    const picked = await qa.suggester(
      withCovers.map((r) => `${r.title} by ${r.authors.join(", ") || "Unknown"}`),
      withCovers
    );

    if (!picked) return;

    newCoverPath = await downloadCover(app, obsidian, picked.coverUrl, bookTitle);
    if (!newCoverPath) {
      if (Notice) new Notice("Failed to download cover image.");
      return;
    }
  } else if (action === "apple") {
    // Search Apple Books for this title
    const searchTerm = await qa.inputPrompt("Search Apple Books", bookTitle);
    if (!searchTerm || !searchTerm.trim()) return;

    if (Notice) new Notice("Searching Apple Books...");
    const results = await searchAppleBooks(obsidian, searchTerm.trim());
    if (!results || results.length === 0) {
      if (Notice) new Notice("No results found on Apple Books.");
      return;
    }

    // Filter to only books with covers
    const withCovers = results.filter((r) => r.coverUrl);
    if (withCovers.length === 0) {
      if (Notice) new Notice("No covers found in search results.");
      return;
    }

    // Let user pick
    const picked = await qa.suggester(
      withCovers.map((r) => `${r.title} by ${r.authors.join(", ") || "Unknown"}`),
      withCovers
    );

    if (!picked) return;

    newCoverPath = await downloadCover(app, obsidian, picked.coverUrl, bookTitle);
    if (!newCoverPath) {
      if (Notice) new Notice("Failed to download cover image.");
      return;
    }
  }

  if (!newCoverPath) return;

  // Update frontmatter
  await app.fileManager.processFrontMatter(activeFile, (fm) => {
    fm.localCoverImage = newCoverPath;
  });

  if (Notice) new Notice(`Cover updated: ${newCoverPath}`);
}

// iOS-compatible: uses obsidian.requestUrl from params
async function downloadCover(app, obsidian, url, bookTitle) {
  try {
    if (!obsidian?.requestUrl) {
      throw new Error("obsidian.requestUrl not available");
    }

    const response = await obsidian.requestUrl({ url, method: "GET" });

    if (response.status !== 200) {
      console.error("Cover download failed:", response.status);
      return null;
    }

    // Determine extension from content-type or URL
    const contentType = response.headers["content-type"] || "";
    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("gif")) ext = "gif";
    else if (contentType.includes("webp")) ext = "webp";
    else if (url.match(/\.(png|gif|webp|jpeg)$/i)) {
      ext = url.match(/\.(png|gif|webp|jpeg)$/i)[1].toLowerCase();
      if (ext === "jpeg") ext = "jpg";
    }

    // Create safe filename
    const safeName = safeFilename(bookTitle) || "cover";
    const coverFolder = SETTINGS.coverFolder;

    // Ensure folder exists
    await app.vault.adapter.mkdir(coverFolder).catch(() => {});

    // Generate unique filename
    let coverPath = `${coverFolder}/${safeName}.${ext}`;
    let counter = 1;
    while (await app.vault.adapter.exists(coverPath)) {
      coverPath = `${coverFolder}/${safeName}-${counter}.${ext}`;
      counter++;
    }

    // Write the file (arrayBuffer is iOS compatible)
    await app.vault.adapter.writeBinary(coverPath, response.arrayBuffer);

    return coverPath;
  } catch (e) {
    console.error("Error downloading cover:", e);
    return null;
  }
}

// iOS-compatible Google Books search
async function searchGoogleBooks(obsidian, query) {
  try {
    if (!obsidian?.requestUrl) {
      throw new Error("obsidian.requestUrl not available");
    }

    const params = new URLSearchParams({
      q: query,
      maxResults: "20",
      printType: "books",
    });

    const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
    const response = await obsidian.requestUrl({ url, method: "GET" });

    if (response.status !== 200) return [];

    const data = response.json;
    const items = Array.isArray(data?.items) ? data.items : [];

    return items.map((item) => {
      const vi = item.volumeInfo || {};
      const imageLinks = vi.imageLinks || {};
      // Prefer larger images
      const coverUrl =
        imageLinks.extraLarge ||
        imageLinks.large ||
        imageLinks.medium ||
        imageLinks.small ||
        imageLinks.thumbnail ||
        "";

      return {
        title: vi.title || "",
        authors: Array.isArray(vi.authors) ? vi.authors : [],
        coverUrl: coverUrl.replace(/^http:/, "https:").replace("&edge=curl", ""),
      };
    });
  } catch (e) {
    console.error("Google Books search error:", e);
    return [];
  }
}

// iOS-compatible Apple Books search
async function searchAppleBooks(obsidian, query) {
  try {
    if (!obsidian?.requestUrl) {
      throw new Error("obsidian.requestUrl not available");
    }

    const params = new URLSearchParams({
      term: query,
      country: "au",
      lang: "en_au",
      media: "ebook",
      entity: "ebook",
      limit: "20",
    });

    const url = `https://itunes.apple.com/search?${params.toString()}`;
    const response = await obsidian.requestUrl({ url, method: "GET" });

    if (response.status !== 200) return [];

    const data = response.json;
    const results = Array.isArray(data?.results) ? data.results : [];

    return results.map((r) => {
      // Get the best cover URL (prefer larger)
      let coverUrl = r.artworkUrl600 || r.artworkUrl512 || r.artworkUrl100 || r.artworkUrl60 || "";
      // Request larger version
      coverUrl = coverUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");

      // Parse authors
      const authorStr = String(r.artistName || "").trim();
      const authors = authorStr
        ? authorStr.split(/\s+&\s+|\s+and\s+/i).map((a) => a.trim()).filter(Boolean)
        : [];

      return {
        title: String(r.trackName || "").trim(),
        authors,
        coverUrl,
      };
    });
  } catch (e) {
    console.error("Apple Books search error:", e);
    return [];
  }
}

function safeFilename(str) {
  if (!str) return "";
  let s = String(str)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Remove leading dots/spaces
  s = s.replace(/^[.\s]+/, "");
  // Truncate to safe length
  if (s.length > 100) s = s.slice(0, 100).trim();
  return s;
}

