import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = 'docker-entrypoint.d/11-frame-ancestors.sh';

function frameConf(frameAncestors: string | undefined): string {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'kkhd-frame-')), 'frame.conf');
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], FRAME_CONF: out };
    if (frameAncestors !== undefined) env['FRAME_ANCESTORS'] = frameAncestors;
    execFileSync('sh', [SCRIPT], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    return readFileSync(out, 'utf8');
}

test('framing is denied by default', () => {
    for (const value of [undefined, '', '   ']) {
        const conf = frameConf(value);
        assert.match(conf, /X-Frame-Options "DENY"/);
        assert.match(conf, /frame-ancestors 'none'/);
    }
});

test('FRAME_ANCESTORS allows the listed origins and drops X-Frame-Options', () => {
    const conf = frameConf('self https://home.example.com http://192.168.1.50:3000 https://*.lan');
    assert.equal(
        conf.trim(),
        `add_header Content-Security-Policy "frame-ancestors 'self' https://home.example.com http://192.168.1.50:3000 https://*.lan" always;`
    );
    assert.doesNotMatch(conf, /X-Frame-Options/);
});

test('hostile FRAME_ANCESTORS cannot break out of the nginx string', () => {
    const conf = frameConf(`https://a.com";add_header X-Pwned 1;# https://$host javascript:alert(1) *`);
    // Exactly one directive, one pair of quotes, no nginx variables.
    assert.equal(conf.trim().split('\n').length, 1);
    assert.equal((conf.match(/"/g) ?? []).length, 2);
    assert.equal((conf.match(/;/g) ?? []).length, 1);
    assert.doesNotMatch(conf, /\$/);
    assert.doesNotMatch(conf, /javascript/);
});

test('only junk falls back to deny', () => {
    const conf = frameConf('javascript:alert(1) ftp://x *');
    assert.match(conf, /X-Frame-Options "DENY"/);
});
