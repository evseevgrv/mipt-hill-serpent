import http from 'node:http';
import worker from './worker/index.js';
const port = Number(process.env.PORT ?? 8080);
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 262144) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
    const response = await worker.fetch(request, { SEARCH_PROFILE: process.env.SEARCH_PROFILE ?? 'local' });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('{}'); }
});
server.listen(port, '0.0.0.0', () => console.log(`Hill Serpent listening on :${port} (single event loop)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
