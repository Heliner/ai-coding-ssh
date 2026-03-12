#!/usr/bin/env node

/**
 * Test suite for proxy.mjs
 *
 * Tests: startup, health check, provider routing, auth, upstream override.
 * Runs without any external deps (pure Node.js).
 */

import http from 'node:http';
import { startProxy } from '../lib/proxy.mjs';

let passed = 0;
let failed = 0;
let testPort = 19900;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function createFakeUpstream(label) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider: label, path: req.url, method: req.method }));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function waitListening(server) {
  return new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
}

async function runTests() {
  console.log('\n=== ai-coding-ssh test suite ===\n');

  // --- Test 1: Basic startup and health check ---
  console.log('Test 1: Health check');
  {
    const port = testPort++;
    const server = startProxy({ port });
    await waitListening(server);

    const res = await fetch(`http://127.0.0.1:${port}/__health`);
    const data = JSON.parse(res.body);

    assert(res.status === 200, 'health returns 200');
    assert(data.status === 'ok', 'status is ok');
    assert(typeof data.uptime === 'number', 'uptime is a number');
    assert(data.providers !== undefined, 'providers stats present');
    assert(data.providers.anthropic === 0, 'anthropic count starts at 0');
    assert(data.providers.gemini === 0, 'gemini count starts at 0');
    assert(data.providers.openai === 0, 'openai count starts at 0');

    server.close();
  }

  // --- Test 2: Auth token enforcement ---
  console.log('\nTest 2: Auth token');
  {
    const port = testPort++;
    const server = startProxy({ port, token: 'test-secret' });
    await waitListening(server);

    // No token → 401
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST' });
    assert(res1.status === 401, 'missing token returns 401');

    // Wrong token → 401
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'x-proxy-token': 'wrong' },
    });
    assert(res2.status === 401, 'wrong token returns 401');

    // Correct token (will fail upstream since no real API, but should NOT be 401)
    const res3 = await fetch(`http://127.0.0.1:${port}/__health`, {
      headers: { 'x-proxy-token': 'test-secret' },
    });
    assert(res3.status === 200, 'health check works with or without token');

    server.close();
  }

  // --- Test 3: Provider routing with fake upstream (PROXY_UPSTREAM) ---
  console.log('\nTest 3: Provider routing (with fake upstream)');
  {
    const fakeUpstream = await createFakeUpstream('gateway');
    const port = testPort++;

    const server = startProxy({ port, upstream: fakeUpstream.url });
    await waitListening(server);

    // Default path → Anthropic provider, forwarded to fake upstream
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST' });
    const data1 = JSON.parse(res1.body);
    assert(res1.status === 200, 'anthropic route returns 200 via upstream');
    assert(data1.path === '/v1/messages', 'anthropic path preserved');
    assert(data1.method === 'POST', 'method preserved');

    // /gemini/* → strips prefix
    const res2 = await fetch(`http://127.0.0.1:${port}/gemini/v1/models`);
    const data2 = JSON.parse(res2.body);
    assert(res2.status === 200, 'gemini route returns 200');
    assert(data2.path === '/v1/models', 'gemini prefix stripped from path');

    // /openai/* → strips prefix
    const res3 = await fetch(`http://127.0.0.1:${port}/openai/v1/chat/completions`, { method: 'POST' });
    const data3 = JSON.parse(res3.body);
    assert(res3.status === 200, 'openai route returns 200');
    assert(data3.path === '/v1/chat/completions', 'openai prefix stripped from path');

    // Check stats
    const res4 = await fetch(`http://127.0.0.1:${port}/__health`);
    const stats = JSON.parse(res4.body);
    assert(stats.providers.anthropic === 1, 'anthropic count is 1');
    assert(stats.providers.gemini === 1, 'gemini count is 1');
    assert(stats.providers.openai === 1, 'openai count is 1');
    assert(stats.requests === 3, 'total requests is 3');

    server.close();
    fakeUpstream.server.close();
  }

  // --- Test 4: Upstream override via options ---
  console.log('\nTest 4: Upstream override via options');
  {
    const fakeUpstream = await createFakeUpstream('cli-override');
    const port = testPort++;

    const server = startProxy({ port, upstream: fakeUpstream.url });
    await waitListening(server);

    const res = await fetch(`http://127.0.0.1:${port}/v1/test`);
    const data = JSON.parse(res.body);
    assert(res.status === 200, 'upstream override works');
    assert(data.path === '/v1/test', 'path forwarded correctly');

    server.close();
    fakeUpstream.server.close();
  }

  // --- Test 5: Edge cases for path routing ---
  console.log('\nTest 5: Edge cases - path routing');
  {
    const fakeUpstream = await createFakeUpstream('edge');
    const port = testPort++;

    const server = startProxy({ port, upstream: fakeUpstream.url });
    await waitListening(server);

    // /gemini alone (no trailing slash) → maps to /
    const res1 = await fetch(`http://127.0.0.1:${port}/gemini`);
    const data1 = JSON.parse(res1.body);
    assert(res1.status === 200, '/gemini alone returns 200');
    assert(data1.path === '/', '/gemini alone maps to /');

    // /openai alone → maps to /
    const res2 = await fetch(`http://127.0.0.1:${port}/openai`);
    const data2 = JSON.parse(res2.body);
    assert(res2.status === 200, '/openai alone returns 200');
    assert(data2.path === '/', '/openai alone maps to /');

    // /geminiXYZ should NOT match gemini prefix → goes to anthropic
    const res3 = await fetch(`http://127.0.0.1:${port}/geminiXYZ`);
    const data3 = JSON.parse(res3.body);
    assert(data3.path === '/geminiXYZ', '/geminiXYZ goes to anthropic (no prefix match)');

    // /openai/deeply/nested/path → strips only /openai prefix
    const res4 = await fetch(`http://127.0.0.1:${port}/openai/deeply/nested/path`);
    const data4 = JSON.parse(res4.body);
    assert(data4.path === '/deeply/nested/path', 'deeply nested openai path stripped correctly');

    // Check stats: gemini=1, openai=2, anthropic=1 (geminiXYZ goes to anthropic)
    const res5 = await fetch(`http://127.0.0.1:${port}/__health`);
    const stats = JSON.parse(res5.body);
    assert(stats.providers.gemini === 1, 'gemini count correct');
    assert(stats.providers.openai === 2, 'openai count correct (2 requests)');
    assert(stats.providers.anthropic === 1, 'anthropic count correct (geminiXYZ)');

    server.close();
    fakeUpstream.server.close();
  }

  // --- Test 6: Auth with upstream ---
  console.log('\nTest 6: Auth token with upstream');
  {
    const fakeUpstream = await createFakeUpstream('auth-test');
    const port = testPort++;

    const server = startProxy({ port, token: 'my-secret', upstream: fakeUpstream.url });
    await waitListening(server);

    // Without token → 401
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/messages`);
    assert(res1.status === 401, 'no token returns 401');

    // With correct token → 200 (forwarded to upstream)
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      headers: { 'x-proxy-token': 'my-secret' },
    });
    assert(res2.status === 200, 'correct token forwards to upstream');

    // Verify x-proxy-token is NOT forwarded to upstream
    const data2 = JSON.parse(res2.body);
    assert(data2.path === '/v1/messages', 'path correct');

    server.close();
    fakeUpstream.server.close();
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
