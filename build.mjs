// Build script: bundles the app with esbuild and writes a ready-to-serve dist/.
//
// The one thing this buys beyond types: content-hashed filenames. Without them the
// old build had to serve JS as `max-age=600, stale-while-revalidate` — a compromise
// that let a stale bundle stick around for ten minutes. Hashed names can be
// `immutable` for a year, and a deploy invalidates them by changing the URL.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const dev = process.argv.includes('--dev');
// --demo swaps the API for the in-memory store in src/demo.ts (the GitHub Pages
// demo and README screenshots). Built to its own directory so it can never be
// mistaken for, or shipped as, the real image contents.
const demo = process.argv.includes('--demo');
const OUT = demo ? 'dist-demo' : 'dist';
const ASSETS = path.join(OUT, 'assets');

const hash8 = (contents) => createHash('sha256').update(contents).digest('hex').slice(0, 8);

async function bundle(entry, { format = 'esm' } = {}) {
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        format,
        target: 'es2022',
        minify: !dev,
        sourcemap: dev ? 'inline' : false,
        legalComments: 'none',
        define: { __DEMO__: demo ? 'true' : 'false' },
        write: false,
        logLevel: 'warning',
    });
    return result.outputFiles[0].text;
}

async function main() {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(ASSETS, { recursive: true });

    // --- app bundle -------------------------------------------------------
    const appJs = await bundle('src/main.ts');
    const appName = `main-${hash8(appJs)}.js`;
    await writeFile(path.join(ASSETS, appName), appJs);

    // --- stylesheet -------------------------------------------------------
    const css = await readFile('styles.css', 'utf8');
    const cssName = `styles-${hash8(css)}.css`;
    await writeFile(path.join(ASSETS, cssName), css);

    // --- service worker ---------------------------------------------------
    // Deliberately NOT hashed: the browser identifies a worker by its URL, and a
    // moving URL would orphan the previous registration on every deploy. It is
    // served no-cache instead. IIFE so it can be registered as a classic worker,
    // which has the widest support.
    const swJs = await bundle('src/sw.ts', { format: 'iife' });
    await writeFile(path.join(OUT, 'sw.js'), swJs);

    // --- html -------------------------------------------------------------
    let html = await readFile('index.html', 'utf8');
    html = html
        .replace('href="styles.css"', `href="assets/${cssName}"`)
        .replace('src="src/main.ts"', `src="assets/${appName}"`);
    if (html.includes('src/main.ts') || html.includes('styles.css')) {
        throw new Error('index.html still references unhashed assets after templating');
    }
    await writeFile(path.join(OUT, 'index.html'), html);

    // --- static assets / icons --------------------------------------------
    await copyFile('favicon.svg', path.join(OUT, 'favicon.svg'));
    await copyFile('favicon.ico', path.join(OUT, 'favicon.ico'));
    await copyFile('apple-touch-icon.png', path.join(OUT, 'apple-touch-icon.png'));
    await copyFile('manifest.json', path.join(OUT, 'manifest.json'));
    await copyFile('icon-192.png', path.join(OUT, 'icon-192.png'));
    await copyFile('icon-512.png', path.join(OUT, 'icon-512.png'));
    await copyFile('icon-maskable-192.png', path.join(OUT, 'icon-maskable-192.png'));
    await copyFile('icon-maskable-512.png', path.join(OUT, 'icon-maskable-512.png'));

    // --- generated config placeholder -------------------------------------
    // Overwritten at container start from $KARAKEEP_URL; shipped so it never 404s.
    await copyFile('env.js', path.join(OUT, 'env.js'));

    console.log(`built ${OUT}/`);
    console.log(`  assets/${appName}  ${(appJs.length / 1024).toFixed(1)} kB`);
    console.log(`  assets/${cssName}  ${(css.length / 1024).toFixed(1)} kB`);
    console.log(`  sw.js              ${(swJs.length / 1024).toFixed(1)} kB`);
    console.log(`  manifest.json`);
    console.log(`  favicon.svg`);
    console.log(`  favicon.ico`);
    console.log(`  apple-touch-icon.png`);
    console.log(`  icon-192.png`);
    console.log(`  icon-512.png`);
    console.log(`  icon-maskable-192.png`);
    console.log(`  icon-maskable-512.png`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
