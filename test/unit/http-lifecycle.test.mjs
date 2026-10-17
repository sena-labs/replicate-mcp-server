import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const prelude = `
  import assert from 'node:assert/strict';
  import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  import { startHttpTransport } from './dist/http-server.js';
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'regression', version: '1' }
  }};
`;

test("initialize/delete cycles close each session once without recursion", async () => {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", prelude + `
    let created = 0, closed = 0, explicitCloseCalls = 0;
    const http = await startHttpTransport({ host: '127.0.0.1', port: 0, createServer: () => {
      created++;
      const server = new McpServer({ name: 'test', version: '1' });
      server.server.onclose = () => { closed++; };
      const close = server.close.bind(server);
      server.close = async () => { explicitCloseCalls++; await close(); };
      return server;
    }});
    const url = 'http://127.0.0.1:' + http.address().port + '/mcp';
    for (let i = 0; i < 8; i++) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(init) });
      assert.equal(res.status, 200);
      const id = res.headers.get('mcp-session-id');
      assert.ok(id);
      await res.text();
      const deleted = await fetch(url, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': id } });
      assert.equal(deleted.status, 200);
      await deleted.text();
      assert.equal(explicitCloseCalls, 0, 'transport onclose must not re-enter server.close');
      const stale = await fetch(url, { method: 'POST', headers: { ...headers, 'mcp-session-id': id },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) });
      assert.equal(stale.status, 404);
      await stale.text();
    }
    assert.equal(created, 8);
    assert.equal(closed, 8);
    await new Promise(resolve => http.close(resolve));
    console.log('lifecycle-ok');
  `], { timeout: 15_000, maxBuffer: 256 * 1024 });
  assert.match(stdout, /lifecycle-ok/);
});

test("malformed/unknown-session requests do not allocate servers", async () => {
  await run(process.execPath, ["--input-type=module", "-e", prelude + `
    let created = 0;
    const http = await startHttpTransport({ host: '127.0.0.1', port: 0, createServer: () => {
      created++; return new McpServer({ name: 'test', version: '1' });
    }});
    const url = 'http://127.0.0.1:' + http.address().port + '/mcp';
    for (const method of ['GET', 'DELETE', 'POST']) {
      const options = { method, headers };
      if (method === 'POST') options.body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' });
      const res = await fetch(url, options);
      assert.equal(res.status, 400); await res.text();
    }
    const unknown = await fetch(url, { method: 'POST', headers: { ...headers, 'mcp-session-id': 'attacker-chosen-id' }, body: JSON.stringify(init) });
    assert.equal(unknown.status, 404); await unknown.text();
    assert.equal(created, 0);
    await new Promise(resolve => http.close(resolve));
  `], { timeout: 15_000 });
});

test("HTTP error logs omit query credentials", async () => {
  const { stderr } = await run(process.execPath, ["--input-type=module", "-e", prelude + `
    const http = await startHttpTransport({ host: '127.0.0.1', port: 0,
      createServer: () => { throw new Error('intentional-test-error'); } });
    const url = 'http://127.0.0.1:' + http.address().port + '/mcp?replicate_api_token=secret-query-canary';
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(init) });
    assert.equal(res.status, 500); await res.text();
    await new Promise(resolve => http.close(resolve));
  `], { timeout: 15_000 });
  assert.match(stderr, /http_request_failed/);
  assert.ok(!stderr.includes("secret-query-canary"));
});
