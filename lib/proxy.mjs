#!/usr/bin/env node

/**
 * ai-coding-ssh - Local API Proxy Server (Multi-Provider)
 *
 * Runs on the developer's Mac, forwards HTTP requests to AI API providers over HTTPS.
 * Supports SSE streaming for Claude Code, Gemini CLI, and Codex CLI.
 *
 * Routing (by path prefix):
 *   /gemini/*  → generativelanguage.googleapis.com  (or PROXY_UPSTREAM)
 *   /openai/*  → api.openai.com                     (or PROXY_UPSTREAM)
 *   (default)  → api.anthropic.com                  (or PROXY_UPSTREAM)
 *
 * PROXY_UPSTREAM routes all providers through a single gateway (e.g. api.aicoding.sh).
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_PORT = 18080;
const DEFAULT_HOST = '127.0.0.1';

// --- Parse a URL string into upstream config ---
function parseUpstreamUrl(urlStr, { allowLocalhost = false } = {}) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    if (!allowLocalhost && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return null;
    return {
      hostname: u.hostname,
      port: u.port ? parseInt(u.port) : (u.protocol === 'https:' ? 443 : 80),
      isHttps: u.protocol === 'https:',
    };
  } catch { return null; }
}

// Resolve upstream: PROXY_UPSTREAM overrides everything (one gateway for all providers),
// otherwise per-provider env vars are checked, then hardcoded defaults.
// PROXY_UPSTREAM allows localhost (explicit user override / local gateway).
// Per-provider env vars filter localhost to prevent self-referencing loops.
function resolveUpstream(envVar, defaultHostname) {
  return (
    parseUpstreamUrl(process.env['PROXY_UPSTREAM'], { allowLocalhost: true }) ||
    parseUpstreamUrl(process.env[envVar]) ||
    { hostname: defaultHostname, port: 443, isHttps: true }
  );
}

// Providers are initialized lazily inside startProxy() so CLI --upstream is applied first.
let PROVIDERS = null;
let keepAliveAgents = null;

function initProviders() {
  PROVIDERS = {
    anthropic: { ...resolveUpstream('ANTHROPIC_BASE_URL', 'api.anthropic.com'), label: 'Anthropic' },
    gemini:    { ...resolveUpstream('GOOGLE_GEMINI_BASE_URL', 'generativelanguage.googleapis.com'), label: 'Gemini' },
    openai:    { ...resolveUpstream('OPENAI_BASE_URL', 'api.openai.com'), label: 'OpenAI' },
  };
  keepAliveAgents = {};
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const AgentClass = provider.isHttps ? https.Agent : http.Agent;
    keepAliveAgents[key] = new AgentClass({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });
  }
}

// --- Logging ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLogLevel = LOG_LEVELS.info;

function log(level, ...args) {
  if (LOG_LEVELS[level] >= currentLogLevel) {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

// --- Auth Token ---
let authToken = null;

function checkAuth(req, res) {
  if (!authToken) return true;
  const header = req.headers['x-proxy-token'] || '';
  if (header === authToken) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing x-proxy-token' }));
  log('warn', `Auth failed from ${req.socket.remoteAddress}`);
  return false;
}

// --- Request Stats ---
const stats = {
  totalRequests: 0,
  activeRequests: 0,
  totalBytes: 0,
  errors: 0,
  startTime: Date.now(),
  byProvider: { anthropic: 0, gemini: 0, openai: 0 },
};

// --- Resolve provider and strip path prefix ---
function resolveProvider(url) {
  if (url.startsWith('/gemini/') || url === '/gemini') {
    return { provider: PROVIDERS.gemini, name: 'gemini', path: url.slice('/gemini'.length) || '/' };
  }
  if (url.startsWith('/openai/') || url === '/openai') {
    return { provider: PROVIDERS.openai, name: 'openai', path: url.slice('/openai'.length) || '/' };
  }
  return { provider: PROVIDERS.anthropic, name: 'anthropic', path: url };
}

// --- Core Proxy Handler ---
function handleRequest(req, res) {
  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      requests: stats.totalRequests,
      active: stats.activeRequests,
      errors: stats.errors,
      providers: stats.byProvider,
    }));
    return;
  }

  if (!checkAuth(req, res)) return;

  const { provider, name, path } = resolveProvider(req.url);

  stats.totalRequests++;
  stats.activeRequests++;
  stats.byProvider[name]++;

  const startTime = Date.now();
  const method = req.method;

  log('info', `→ [${provider.label}] ${method} ${path}`);

  const upstreamHeaders = { ...req.headers };
  delete upstreamHeaders['host'];
  delete upstreamHeaders['x-proxy-token'];
  upstreamHeaders['host'] = provider.hostname;

  const transport = provider.isHttps ? https : http;
  const options = {
    hostname: provider.hostname,
    port: provider.port,
    path: path,
    method: method,
    headers: upstreamHeaders,
    agent: keepAliveAgents[name],
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const statusCode = proxyRes.statusCode;
    const isSSE = (proxyRes.headers['content-type'] || '').includes('text/event-stream');

    log('info', `← [${provider.label}] ${statusCode} ${method} ${path}${isSSE ? ' [SSE]' : ''}`);

    const responseHeaders = { ...proxyRes.headers };
    if (isSSE) {
      responseHeaders['cache-control'] = 'no-cache';
      responseHeaders['x-accel-buffering'] = 'no';
    }

    res.writeHead(statusCode, responseHeaders);

    let responseSize = 0;
    proxyRes.on('data', (chunk) => { responseSize += chunk.length; res.write(chunk); });
    proxyRes.on('end', () => {
      res.end();
      stats.activeRequests--;
      stats.totalBytes += responseSize;
      log('info', `✓ [${provider.label}] ${method} ${path} ${statusCode} ${responseSize}B ${Date.now() - startTime}ms`);
    });
    proxyRes.on('error', (err) => {
      log('error', `[${provider.label}] Response error: ${err.message}`);
      stats.errors++;
      stats.activeRequests--;
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', detail: err.message }));
    });
  });

  proxyReq.on('error', (err) => {
    log('error', `[${provider.label}] Request error: ${err.message}`);
    stats.errors++;
    stats.activeRequests--;
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', detail: err.message }));
  });

  proxyReq.setTimeout(300000);
  req.pipe(proxyReq);
}

function providerUrl(p) {
  const scheme = p.isHttps ? 'https' : 'http';
  const portSuffix = (p.isHttps && p.port === 443) || (!p.isHttps && p.port === 80) ? '' : `:${p.port}`;
  return `${scheme}://${p.hostname}${portSuffix}`;
}

// --- Start Server ---
export function startProxy(options = {}) {
  const port = options.port !== undefined ? options.port : (parseInt(process.env.PROXY_PORT) || DEFAULT_PORT);
  const host = options.host || process.env.PROXY_HOST || DEFAULT_HOST;
  authToken = options.token || process.env.PROXY_TOKEN || null;

  if (options.upstream) process.env['PROXY_UPSTREAM'] = options.upstream;
  if (options.debug) currentLogLevel = LOG_LEVELS.debug;

  // Reset stats for this instance
  stats.totalRequests = 0;
  stats.activeRequests = 0;
  stats.totalBytes = 0;
  stats.errors = 0;
  stats.startTime = Date.now();
  stats.byProvider = { anthropic: 0, gemini: 0, openai: 0 };

  // Initialize providers AFTER options/env are fully set
  initProviders();

  const server = http.createServer(handleRequest);
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;
  server.requestTimeout = 300000;

  server.listen(port, host, () => {
    log('info', `AI SSH Proxy started on ${host}:${port}`);
    log('info', `Providers:`);
    log('info', `  Anthropic (default) → ${providerUrl(PROVIDERS.anthropic)}`);
    log('info', `  Gemini   (/gemini)  → ${providerUrl(PROVIDERS.gemini)}`);
    log('info', `  OpenAI   (/openai)  → ${providerUrl(PROVIDERS.openai)}`);
    if (authToken) log('info', `Auth token required: yes`);
    log('info', `Health check: http://${host}:${port}/__health`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log('error', `Port ${port} already in use.`);
      process.exit(1);
    }
    log('error', `Server error: ${err.message}`);
  });

  function shutdown(signal) {
    log('info', `Received ${signal}, shutting down...`);
    server.close(() => { log('info', 'Proxy stopped.'); process.exit(0); });
    setTimeout(() => process.exit(0), 5000);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

// --- CLI entry ---
if (process.argv[1] && process.argv[1].endsWith('proxy.mjs')) {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port': case '-p':   opts.port = parseInt(args[++i]); break;
      case '--host': case '-h':   opts.host = args[++i]; break;
      case '--token': case '-t':  opts.token = args[++i]; break;
      case '--upstream': case '-u': opts.upstream = args[++i]; break;
      case '--debug': case '-d':  opts.debug = true; break;
      case '--help':
        console.log(`
ai-ssh-proxy - Local API relay for AI coding tools over SSH

Supports: Claude Code (Anthropic), Gemini CLI (Google), Codex CLI (OpenAI)

Usage: node proxy.mjs [options]

Options:
  -p, --port <port>        Listen port (default: 18080, env: PROXY_PORT)
  -h, --host <host>        Listen host (default: 127.0.0.1, env: PROXY_HOST)
  -t, --token <token>      Auth token for x-proxy-token header (env: PROXY_TOKEN)
  -u, --upstream <url>     Route ALL providers to this gateway (env: PROXY_UPSTREAM)
                           e.g. https://api.aicoding.sh
  -d, --debug              Enable debug logging
      --help               Show this help

Routing:
  /gemini/*  → GOOGLE_GEMINI_BASE_URL or generativelanguage.googleapis.com
  /openai/*  → OPENAI_BASE_URL        or api.openai.com
  /*         → ANTHROPIC_BASE_URL     or api.anthropic.com

  -u/PROXY_UPSTREAM overrides all of the above with a single gateway.
`);
        process.exit(0);
    }
  }

  startProxy(opts);
}
