# claude-ssh-proxy

> [中文版](./README.md)

[![AI-Powered](https://img.shields.io/badge/AI--Powered-Claude-blueviolet)](https://claude.ai)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blue)](https://code.claude.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

![demo](./demo.gif)

Use **Claude Code CLI** on remote intranet Linux servers that have **no public IP and no internet access**.

By leveraging SSH reverse tunnels, the local API proxy port on your Mac is "carried into" the remote server, allowing Claude Code to reach the Anthropic API through `localhost`.

## Features

- **Zero compilation, pure source code** — Shell scripts + Node.js source only, no binaries, fully readable and auditable
- **One-command connection** — `claude-ssh user@server` auto-starts proxy, creates SSH tunnel, and configures remote env
- **SSE streaming support** — Full Server-Sent Events passthrough for Claude Code's streaming output
- **Multi-server reuse** — A single proxy instance can serve multiple SSH tunnels simultaneously
- **Optional authentication** — Token-based auth for team sharing scenarios
- **Offline installation** — Install Claude Code CLI on air-gapped servers with no internet

## How It Works

```
Remote Intranet Server            Developer's Mac
┌─────────────────────┐           ┌──────────────────────┐
│  Claude Code CLI    │           │  API Proxy (:18080)  │
│    ↓                │           │    ↓                 │
│  localhost:18080  ──┼── SSH-R ──┼→ 127.0.0.1:18080     │
│                     │  tunnel   │    ↓                 │
└─────────────────────┘           │  api.anthropic.com   │
                                  └──────────────────────┘
```

When you SSH into the remote server, the `-R` (reverse port forwarding) flag maps your local proxy port to `localhost:18080` on the remote machine. Claude Code CLI on the remote server uses the `ANTHROPIC_BASE_URL` environment variable pointing to that address. All API requests travel back through the SSH tunnel to the local proxy, which forwards them to the Anthropic API.

## Project Structure

```
claude-ssh-proxy/
├── bin/
│   ├── claude-ssh                 # Core connection script (Bash)
│   └── claude-ssh-install-remote  # Remote installation helper (Bash)
├── lib/
│   └── proxy.mjs                  # API proxy server (Node.js, pure source)
├── setup.sh                       # Local one-click install script
├── package.json
├── LICENSE
├── README.md                      # Chinese documentation
└── README_EN.md                   # English documentation
```

All code consists of **readable source files** with no compiled artifacts or binary dependencies. Shell scripts run directly; the Node.js proxy is a single-file ES Module requiring no `npm install`.

## Quick Start

### 1. Install (on your Mac)

```bash
git clone https://github.com/Heliner/claude-ssh-proxy.git
cd claude-ssh-proxy
bash setup.sh
```

Or use directly without installation:

```bash
# Run directly from the project directory
./bin/claude-ssh user@server
```

### 2. Install Claude Code on the Remote Server

```bash
# Online install (remote server needs npm registry access)
claude-ssh --install-remote user@server

# Offline install (remote server has no internet)
claude-ssh-install-remote --offline user@server
```

### 3. Connect and Use

```bash
claude-ssh user@server
```

Once on the remote server, just run `claude`. Environment variables are already configured.

## Prerequisites

**Local Mac:**

- Node.js >= 18
- SSH client

**Remote Server:**

- Node.js >= 18 (required by Claude Code CLI)
- SSH Server (default localhost binding is sufficient)

## Command Reference

### `claude-ssh`

Core command. Automatically starts local proxy, establishes SSH connection, creates reverse tunnel, and configures remote environment variables.

```bash
# Basic usage
claude-ssh user@192.168.1.100

# Custom ports
claude-ssh -p 9090 -r 9090 user@server

# Use SSH key
claude-ssh -i ~/.ssh/id_ed25519 user@server

# Custom SSH port
claude-ssh -P 2222 user@server

# With auth token (for team sharing)
claude-ssh -t my-secret-token user@server

# Extra SSH args (e.g., port forwarding)
claude-ssh user@server -- -L 3000:localhost:3000

# Keep proxy running after disconnect (useful for multiple servers)
claude-ssh -k user@server1
claude-ssh --no-proxy user@server2  # reuse existing proxy
```

### `claude-ssh-install-remote`

Install Claude Code CLI on the remote server.

```bash
# Online install
claude-ssh-install-remote user@server

# Offline install (pack local npm package and transfer via scp)
claude-ssh-install-remote --offline user@server
```

### Proxy Server (standalone)

```bash
# Start proxy directly
node lib/proxy.mjs

# Custom configuration
node lib/proxy.mjs --port 9090 --token my-token --debug

# Health check
curl http://localhost:18080/__health
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_SSH_PROXY_PORT` | Local proxy port | 18080 |
| `CLAUDE_SSH_REMOTE_PORT` | Remote tunnel port | 18080 |
| `CLAUDE_SSH_PROXY_TOKEN` | Proxy auth token | none |
| `ANTHROPIC_API_KEY` | Anthropic API Key | none (auto-forwarded to remote) |

## Common Scenarios

### Scenario 1: Connect to a Single Intranet Server

```bash
claude-ssh dev@10.0.1.50
# Then just use claude
```

### Scenario 2: Connect to Multiple Servers (shared proxy)

```bash
# Terminal 1: connect to first server, -k keeps proxy running
claude-ssh -k dev@server1

# Terminal 2: connect to second server, --no-proxy reuses proxy
claude-ssh --no-proxy dev@server2
```

### Scenario 3: Jump Host (multi-hop SSH)

```bash
# Connect to target through a bastion/jump server
claude-ssh dev@target -- -J jump@bastion
```

### Scenario 4: Air-Gapped Environment (no internet at all)

```bash
# First, offline install Claude Code
claude-ssh-install-remote --offline dev@airgapped-server

# Then connect normally
claude-ssh dev@airgapped-server
```

## Troubleshooting

**Proxy fails to start:** Check `/tmp/claude-ssh-proxy.log`

**Remote claude reports connection refused:** Verify tunnel ports match, check with `ss -tlnp | grep 18080`

**SSE streaming not working:** Ensure Node.js >= 18; the proxy disables response buffering by default

**Port already in use:** Switch to a different port: `claude-ssh -p 19090 -r 19090 user@server`

## Acknowledgments

This project was developed with assistance from [Claude](https://claude.ai) AI. Architecture design, code implementation, and documentation were all completed through AI collaboration.

## License

MIT
