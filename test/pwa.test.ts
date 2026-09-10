import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

test('manifest.json exists and has valid PWA properties', async () => {
    const raw = await readFile('manifest.json', 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(typeof manifest.name, 'string');
    assert.equal(typeof manifest.short_name, 'string');
    assert.equal(manifest.display, 'standalone');
    assert.equal(typeof manifest.start_url, 'string');
    assert.ok(Array.isArray(manifest.icons));
    assert.ok(manifest.icons.length >= 2);

    for (const icon of manifest.icons) {
        assert.ok(icon.src, 'icon must have src');
        assert.ok(icon.sizes, 'icon must have sizes');
        assert.ok(icon.type, 'icon must have type');

        // Verify icon file exists in project root
        await access(path.resolve(icon.src));
    }
});

test('index.html contains link to manifest and PWA mobile meta tags', async () => {
    const html = await readFile('index.html', 'utf8');
    assert.ok(html.includes('rel="manifest"'), 'index.html must link to manifest');
    assert.ok(html.includes('name="theme-color"'), 'index.html must specify theme-color');
    assert.ok(html.includes('name="mobile-web-app-capable"'), 'index.html must specify mobile-web-app-capable');
    assert.ok(html.includes('name="apple-mobile-web-app-capable"'), 'index.html must specify apple-mobile-web-app-capable');
});
