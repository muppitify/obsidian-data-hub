// batch-ai-summaries.js — QuickAdd script for Obsidian
//
// Cycles through all book notes and generates AI summaries for books
// that have empty or missing ai_summary fields.
//
// Calls local Ollama instance directly.
//
// Usage:
//   1. Run via QuickAdd
//   2. Review count of books needing summaries
//   3. Confirm to start processing
//   4. Each book is processed and updated automatically

const SETTINGS = {
  // Folder containing book notes
  bookFolder: "books/books",

  // Ollama settings (update URL if using a remote server)
  ollama: {
    url: "http://localhost:11434/api/generate",
    model: "llama3.1:latest", // Match your QuickAdd AI Assistant model
    timeout: 60000, // 60 seconds per request
  },

  // Summary generation
  maxWordsTarget: 150, // Target ~120-180 words
};

// Build prompt for AI
function buildPrompt(fm, filename) {
  const normaliseList = (v) => {
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x || "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim())
        .filter(Boolean)
        .join(", ");
    }
    if (typeof v === "string") {
      return v.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    }
    return v ? String(v) : "";
  };

  const title = fm.title || filename;
  const subtitle = fm.subtitle || "";
  const author = normaliseList(fm.author);
  const isbn13 = fm.isbn13 || "";
  const isbn10 = fm.isbn10 || "";
  const publisher = fm.publisher || "";
  const publishDate = fm.publishDate || "";
  const genre = normaliseList(fm.genre);
  const description = fm.description || "";

  return `Write a high-quality book summary using the metadata below. Do not quote the existing description.
British English. 120 to 180 words. No fluff.

Output EXACTLY one YAML line only, using double quotes, like:
ai_summary: "..."

The value must be a single line (no newlines). Escape any " characters with \\".

Metadata:
Title: ${title}
Subtitle: ${subtitle}
Author: ${author}
ISBN-13: ${isbn13}
ISBN-10: ${isbn10}
Publisher: ${publisher}
Published: ${publishDate}
Genre: ${genre}
Existing description: ${description}`;
}

// Parse AI response to extract summary
function parseAiResponse(response) {
  const text = String(response || "").trim();

  // Try to extract from YAML format: ai_summary: "..."
  const yamlMatch = text.match(/ai_summary:\s*"(.*)"\s*$/);
  if (yamlMatch) {
    return yamlMatch[1].replace(/\\"/g, '"');
  }

  // If no YAML format, use the raw response (cleaned up)
  const cleaned = text
    .replace(/^ai_summary:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

// Call Ollama API (uses obsidian.requestUrl for iOS compatibility)
async function callOllama(obsidian, prompt) {
  // Use Obsidian's requestUrl API for iOS compatibility
  if (!obsidian?.requestUrl) {
    throw new Error("obsidian.requestUrl is not available");
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Ollama request timed out"));
    }, SETTINGS.ollama.timeout);
  });

  try {
    const response = await Promise.race([
      obsidian.requestUrl({
        url: SETTINGS.ollama.url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: SETTINGS.ollama.model,
          prompt: prompt,
          stream: false,
        }),
      }),
      timeoutPromise,
    ]);

    clearTimeout(timeoutId);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data = typeof response.json === "object" ? response.json : JSON.parse(response.text || "{}");
    return data.response || "";
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// Check if file is in books folder
function isInBooksFolder(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/");
  const prefix = SETTINGS.bookFolder.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return p.startsWith(prefix);
}

// Get frontmatter from file
function getFrontmatter(app, file) {
  const cache = app?.metadataCache?.getFileCache(file);
  return cache?.frontmatter || null;
}

// Check if ai_summary needs generation
function needsSummary(fm) {
  if (!fm) return false;
  if (!fm.title) return false; // Not a valid book note
  const summary = String(fm.ai_summary || "").trim();
  return !summary || summary === '""' || summary === "''";
}

module.exports = async (params) => {
  const app = params?.app;
  const qa = params?.quickAddApi;
  const obsidian = params?.obsidian;

  if (!app || !qa) {
    throw new Error("QuickAdd context missing.");
  }

  const Notice = obsidian?.Notice || globalThis.Notice;

  // Find all book notes needing summaries
  const allFiles = app.vault.getFiles();
  const booksNeedingSummary = [];

  for (const file of allFiles) {
    if (file.extension !== "md") continue;
    if (!isInBooksFolder(file.path)) continue;

    const fm = getFrontmatter(app, file);
    if (needsSummary(fm)) {
      booksNeedingSummary.push({ file, fm, title: fm?.title || file.basename });
    }
  }

  if (booksNeedingSummary.length === 0) {
    if (Notice) new Notice("All books already have AI summaries!");
    return;
  }

  // Show summary and confirm
  const proceed = await qa.yesNoPrompt(
    "Generate AI Summaries",
    `Found ${booksNeedingSummary.length} book(s) missing AI summaries.\n\nThis will call Ollama (${SETTINGS.ollama.model}) for each book.\n\nContinue?`
  );

  if (!proceed) {
    if (Notice) new Notice("Cancelled.");
    return;
  }

  // Process each book
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (let i = 0; i < booksNeedingSummary.length; i++) {
    const { file, fm, title } = booksNeedingSummary[i];
    const progress = `[${i + 1}/${booksNeedingSummary.length}]`;

    if (Notice) new Notice(`${progress} Processing: ${title}`);

    try {
      // Build prompt
      const prompt = buildPrompt(fm, file.basename);

      // Call Ollama
      const response = await callOllama(obsidian, prompt);

      // Parse response
      const summary = parseAiResponse(response);

      if (!summary) {
        throw new Error("Empty response from AI");
      }

      // Update frontmatter
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.ai_summary = summary;
      });

      successCount++;

      // Small delay between requests to not overwhelm Ollama
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      errorCount++;
      errors.push({ title, error: e.message });
      console.error(`Error processing "${title}":`, e);
    }
  }

  // Final summary
  let message = `AI Summary generation complete!\n✅ ${successCount} successful\n❌ ${errorCount} errors`;

  if (errors.length > 0) {
    message += "\n\nErrors:";
    for (const err of errors.slice(0, 5)) {
      message += `\n• ${err.title}: ${err.error}`;
    }
    if (errors.length > 5) {
      message += `\n... and ${errors.length - 5} more`;
    }
  }

  if (Notice) new Notice(message);
};

