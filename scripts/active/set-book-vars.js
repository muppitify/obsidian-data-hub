module.exports = async (params) => {
  const vars = params.variables ?? (params.variables = {});

  const file = app.workspace.getActiveFile();
  if (!file) throw new Error("No active file.");

  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter ?? {};

  const pick = (...keys) => {
    for (const k of keys) {
      const v = fm?.[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return "";
  };

  // Convert array or wikilink to clean string
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

  vars.title = pick("title") || file.basename;
  vars.subtitle = pick("subtitle");
  vars.author = normaliseList(pick("author")); // Array of wikilinks → "Author One, Author Two"
  vars.isbn13 = pick("isbn13");
  vars.isbn10 = pick("isbn10");
  vars.publisher = pick("publisher");
  vars.publishDate = pick("publishDate");
  vars.genre = normaliseList(pick("genre")); // Array of genres → "Fiction, Thriller"
  vars.description = pick("description");

  return ""; // nothing to insert into the note body
};
