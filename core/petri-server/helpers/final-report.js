const fs = require('fs');
const path = require('path');

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function embedImageReferences(html, outputDir) {
  let next = html;
  const embedded = [];
  for (const name of fs.readdirSync(outputDir)) {
    const mime = IMAGE_MIME[path.extname(name).toLowerCase()];
    const filePath = path.join(outputDir, name);
    if (!mime || !fs.statSync(filePath).isFile()) continue;
    const dataUri = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    const escaped = escapeRegExp(name);
    const attributePattern = new RegExp(`((?:src|href)=["'])(?:\\./)?${escaped}(["'])`, 'gi');
    const cssPattern = new RegExp(`(url\\(["']?)(?:\\./)?${escaped}(["']?\\))`, 'gi');
    const replaced = next.replace(attributePattern, `$1${dataUri}$2`).replace(cssPattern, `$1${dataUri}$2`);
    if (replaced !== next) embedded.push(name);
    next = replaced;
  }
  return {html: next, embedded};
}

function materializeFinalReport({outputDir, generatedAt = new Date().toISOString(), transformHtml = (html) => html}) {
  const sourceName = ['report.html', 'report-template.html'].find((name) => fs.existsSync(path.join(outputDir, name)));
  if (!sourceName) {
    const error = new Error('report_source_not_found');
    error.code = 'report_source_not_found';
    throw error;
  }
  const sourceHtml = transformHtml(fs.readFileSync(path.join(outputDir, sourceName), 'utf8'));
  const embedded = embedImageReferences(sourceHtml, outputDir);
  const marker = `<meta name="petri-final-report-generated-at" content="${generatedAt}">`;
  const html = /<head(?:\s[^>]*)?>/i.test(embedded.html)
    ? embedded.html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${marker}`)
    : `${marker}\n${embedded.html}`;
  const fileName = 'final-report.html';
  fs.writeFileSync(path.join(outputDir, fileName), html, 'utf8');
  return {fileName, sourceName, generatedAt, embeddedAssets: embedded.embedded};
}

module.exports = {materializeFinalReport};
