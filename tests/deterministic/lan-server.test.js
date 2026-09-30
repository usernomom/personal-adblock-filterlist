const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const serverPath = path.join(root, 'tests/live/serve-userscripts-lan.mjs');

async function unusedPort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

test('LAN server serves current source with local metadata and no retired endpoints', async () => {
    const port = await unusedPort();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'userscript-lan-test-'));
    const child = spawn(process.execPath, [serverPath], {
        cwd: root,
        env: {
            ...process.env,
            USERSCRIPT_DEV_HOST: '127.0.0.1',
            USERSCRIPT_DEV_PORT: String(port),
            USERSCRIPT_LIVE_LOG: path.join(temporary, 'live.log'),
            USERSCRIPT_HTTP_LOG: path.join(temporary, 'http.log'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = 'http://127.0.0.1:' + port;
    try {
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            if (child.exitCode !== null) throw new Error('LAN server exited before listening');
            try {
                const response = await fetch(base + '/google_interface_cleanup.meta.js');
                ready = response.status === 200;
                if (ready) break;
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(ready, true);
        const name = 'google_interface_cleanup.user.js';
        const response = await fetch(base + '/' + name);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.ok(body.startsWith('// ==UserScript=='));
        assert.match(body, new RegExp('@downloadURL\\s+http://127.0.0.1:' + port + '/' + name));
        assert.match(body, new RegExp('@updateURL\\s+http://127.0.0.1:' + port + '/' + name));
        const source = fs.readFileSync(path.join(root, name), 'utf8');
        assert.match(source, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com/);
        assert.equal((await fetch(base + '/__ios/replay-demo')).status, 404);
        assert.equal((await fetch(base + '/__ios_test_command')).status, 404);
        assert.equal((await fetch(base + '/__userscript_log', {
            method: 'POST', body: '{"event":"test"}',
        })).status, 204);
        assert.match(fs.readFileSync(path.join(temporary, 'live.log'), 'utf8'), /"event":"test"/);
    } finally {
        child.kill();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
