import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.GOOGLE_CLEANUP_DEV_PORT || 8766);
const scriptUrl = new URL('../../google_interface_cleanup.user.js', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);

const server = http.createServer(async (request, response) => {
  if (request.url !== '/google_interface_cleanup.user.js') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
    return;
  }

  try {
    const content = await readFile(scriptPath);
    response.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': content.length,
    });
    response.end(content);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`${error.message}\n`);
  }
});

server.listen(port, host, () => {
  console.log(`Google cleanup development userscript: http://${host}:${port}/google_interface_cleanup.user.js`);
});
