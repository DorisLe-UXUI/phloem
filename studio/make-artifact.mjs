// Builds studio/dist/artifact.html: the Studio as a single publishable page (no doctype/html/head/body — the
// Artifact tool wraps it; title + fonts + inline CSS/JS only).
import { readFileSync, writeFileSync } from 'node:fs';
const css = readFileSync('studio/dist/studio.css', 'utf8');
const js = readFileSync('studio/dist/studio.js', 'utf8').replace(/<\/script>/gi, '<\\/script>');
const html = `<title>Phloem Email</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Poppins:wght@600;800&display=swap" rel="stylesheet" />
<style>
:root { color-scheme: dark; padding: 0 !important; }
${css}
</style>
<div id="root"></div>
<script>
${js}
</script>
`;
writeFileSync('studio/dist/artifact.html', html);
console.log(`studio/dist/artifact.html ${(html.length / 1024).toFixed(0)} KB`);
