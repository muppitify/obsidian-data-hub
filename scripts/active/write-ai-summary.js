module.exports = async (params) => {
  const vars = params.variables ?? {};
  const raw = (vars.summary ?? vars.output ?? "").trim(); // supports either variable name
  if (!raw) throw new Error("AI output variable was empty (expected summary/output).");

  // If the model returned a YAML line, extract the value; otherwise use raw.
  let text = raw;
  const m = raw.match(/^ai_summary:\s*"(.*)"\s*$/);
  if (m) text = m[1].replace(/\\"/g, '"');

  // Force single-line frontmatter-safe text
  const oneLine = text.replace(/\s+/g, " ").trim();

  const file = app.workspace.getActiveFile();
  if (!file) throw new Error("No active file.");

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.ai_summary = oneLine;
  });

  return "";
};
