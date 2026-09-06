// Inlines the Vite artifact build (dist-artifact/) into one HTML fragment,
// dist-artifact/swimlanes.html, ready to publish as a claude.ai Artifact.
// The Artifact tool wraps the fragment in its own doctype/head/body, so the
// output deliberately has no <html>, <head>, or <body> tags.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist-artifact/', import.meta.url).pathname;
const assets = join(dist, 'assets');

const files = readdirSync(assets);
const js = files.filter(f => f.endsWith('.js'));
const css = files.filter(f => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one JS bundle, found ${js.length}`);

const script = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const styles = css.map(f => readFileSync(join(assets, f), 'utf8')).join('\n');

const html = `<title>Swimlanes</title>
<style>
${styles}
</style>
<div id="root"></div>
<script type="module">
${script}
</script>
`;

const out = join(dist, 'swimlanes.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
