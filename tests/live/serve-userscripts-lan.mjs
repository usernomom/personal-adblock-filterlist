import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const host = process.env.USERSCRIPT_DEV_HOST || '0.0.0.0';
const port = Number(process.env.USERSCRIPT_DEV_PORT || 8767);
const liveLog = process.env.USERSCRIPT_LIVE_LOG || path.join(os.tmpdir(), 'userscript-live.log');
const requestLog = process.env.USERSCRIPT_HTTP_LOG || path.join(os.tmpdir(), 'userscript-http.log');
const maxLogBody = 1024 * 1024;

for (const file of [liveLog, requestLog]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}

function headers(contentType = 'text/plain; charset=utf-8') {
    return {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
    };
}

function metadataBlock(text) {
    const match = text.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m);
    return match ? match[0] : null;
}

function localizeMetadata(text, requestHost, sourceName) {
    const block = metadataBlock(text);
    if (!block) return null;
    const installUrl = 'http://' + requestHost + '/' + sourceName;
    let localized = block;
    for (const key of ['downloadURL', 'updateURL']) {
        const line = '// @' + key + '  ' + installUrl;
        const pattern = new RegExp('^// @' + key + '\\s+.*$', 'm');
        localized = pattern.test(localized)
            ? localized.replace(pattern, line)
            : localized.replace('// ==/UserScript==', line + '\n// ==/UserScript==');
    }
    return text.replace(block, localized);
}

function safeSourceName(pathname) {
    let name;
    try {
        name = decodeURIComponent(pathname).slice(1);
    } catch {
        return null;
    }
    if (!name || name !== path.basename(name) || name.includes('\\')) return null;
    if (name.endsWith('.user.js')) return { sourceName: name, metadataOnly: false };
    if (name.endsWith('.meta.js')) {
        return { sourceName: name.slice(0, -'.meta.js'.length) + '.user.js',
                 metadataOnly: true };
    }
    return null;
}

const server = http.createServer((req, res) => {
    let url;
    try {
        url = new URL(req.url, 'http://local.invalid');
    } catch {
        res.writeHead(400, headers());
        res.end('Bad URL');
        return;
    }
    fs.appendFileSync(requestLog, new Date().toISOString() + ' ' + req.method + ' ' + url.pathname + '\n');

    if (req.method === 'OPTIONS' && url.pathname === '/__userscript_log') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'content-type',
        });
        res.end();
        return;
    }
    if (req.method === 'POST' && url.pathname === '/__userscript_log') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > maxLogBody) req.destroy();
        });
        req.on('end', () => {
            fs.appendFileSync(liveLog, body + '\n');
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
            res.end();
        });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, headers());
        res.end('Method not allowed');
        return;
    }
    const target = safeSourceName(url.pathname);
    if (!target) {
        res.writeHead(404, headers());
        res.end('Not found');
        return;
    }
    fs.readFile(path.join(root, target.sourceName), 'utf8', (error, source) => {
        if (error) {
            res.writeHead(404, headers());
            res.end('Not found');
            return;
        }
        const requestHost = req.headers.host || (host + ':' + port);
        const localized = localizeMetadata(source, requestHost, target.sourceName);
        if (!localized) {
            res.writeHead(500, headers());
            res.end('Metadata block not found');
            return;
        }
        const body = target.metadataOnly ? metadataBlock(localized) + '\n' : localized;
        res.writeHead(200, {
            ...headers('text/javascript; charset=utf-8'),
            'Content-Length': Buffer.byteLength(body),
        });
        res.end(req.method === 'HEAD' ? undefined : body);
    });
});

server.listen(port, host, () => {
    console.log('USERSCRIPT_LAN_DEV http://' + host + ':' + port);
    console.log('Working tree: ' + root);
    console.log('Live log: ' + liveLog);
    console.log('Request log: ' + requestLog);
});
