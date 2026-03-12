# ai-coding-ssh

> [English Version](./README_EN.md)

[![AI-Powered](https://img.shields.io/badge/AI--Powered-Claude-blueviolet)](https://claude.ai)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blue)](https://code.claude.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

![demo](./demo.gif)

在**无公网 IP、无外网**的内网 Linux 服务器上使用 Claude Code、Gemini CLI、Codex CLI。

通过 SSH 反向隧道，将本地 Mac 上的 API 代理端口"带入"远程服务器，让远程的 AI 编程工具直接通过 `localhost` 访问各家 API。

## 特性

- **多 AI 工具支持** — 同时支持 Claude Code (Anthropic)、Gemini CLI (Google)、Codex CLI (OpenAI)
- **零编译，纯源码** — 全部由 Shell 脚本 + Node.js 源码组成，没有任何二进制文件，可直接阅读、修改和审计
- **一条命令连接** — `ai-coding-ssh user@server` 自动完成代理启动、SSH 隧道建立、远程环境变量配置
- **SSE 流式支持** — 代理层完整透传 Server-Sent Events，流式输出不受影响
- **多服务器复用** — 一个代理实例可同时服务多条 SSH 隧道
- **可选鉴权** — 支持 token 认证，适合团队共用场景
- **统一网关** — 支持通过 `PROXY_UPSTREAM` 将所有 AI 提供商路由到同一网关
- **离线安装** — 支持在无外网的服务器上离线安装 Claude Code CLI

## 原理

```
远程内网服务器                        开发者 Mac
┌──────────────────────┐           ┌──────────────────────────────┐
│  Claude Code CLI     │           │  API Proxy (:18080)          │
│  Gemini CLI          │           │    ↓ 路由:                   │
│  Codex CLI           │           │    /*        → anthropic.com │
│    ↓                 │           │    /gemini/* → googleapis    │
│  localhost:18080  ───┼── SSH-R ──┼→   /openai/* → openai.com   │
│                      │  tunnel   │                              │
└──────────────────────┘           └──────────────────────────────┘
```

开发者通过 SSH 连接远程服务器时，利用 SSH 的 `-R`（反向端口转发）功能，将本地代理端口映射到远程服务器的 `localhost:18080`。远程的各 AI 编程工具通过环境变量（`ANTHROPIC_BASE_URL`、`GOOGLE_GEMINI_BASE_URL`、`OPENAI_BASE_URL`）指向该地址，所有 API 请求经 SSH 隧道回传到本地代理，由代理按路径前缀分发至对应的 API 提供商。

## 项目结构

```
ai-coding-ssh/
├── bin/
│   ├── ai-coding-ssh                 # 核心连接脚本（Bash）
│   └── ai-coding-ssh-install-remote  # 远程安装辅助脚本（Bash）
├── lib/
│   └── proxy.mjs                  # 多提供商 API 代理服务器（Node.js, 纯源码）
├── test/
│   └── test-proxy.mjs             # 自动化测试套件
├── setup.sh                       # 本地一键安装脚本
├── package.json
├── LICENSE
└── README.md
```

所有代码均为**可读的源码文件**，不包含任何编译产物或二进制依赖。Shell 脚本直接执行，Node.js 代理为单文件 ES Module，无需 `npm install`。

## 快速开始

### 1. 安装（在 Mac 上）

```bash
git clone https://github.com/Heliner/ai-coding-ssh.git
cd ai-coding-ssh
bash setup.sh
```

或者直接使用，无需安装：

```bash
# 直接从项目目录运行
./bin/ai-coding-ssh user@server
```

### 2. 在远程服务器安装 Claude Code

```bash
# 在线安装（远程服务器需要能访问 npm registry）
ai-coding-ssh --install-remote user@server

# 离线安装（远程服务器无外网）
ai-coding-ssh-install-remote --offline user@server
```

### 3. 连接并使用

```bash
ai-coding-ssh user@server
```

进入远程服务器后，直接运行 `claude` 即可。环境变量已自动配置好。

## 前置要求

**本地 Mac：**

- Node.js >= 18
- SSH 客户端

**远程服务器：**

- Node.js >= 18（Claude Code CLI 的运行依赖）
- SSH Server（使用默认的 localhost 绑定即可）

## 命令详解

### `ai-coding-ssh`

核心命令。自动启动本地代理 → SSH 连接 → 建立反向隧道 → 配置远程环境变量。

```bash
# 基本用法
ai-coding-ssh user@192.168.1.100

# 自定义端口
ai-coding-ssh -p 9090 -r 9090 user@server

# 使用 SSH 密钥
ai-coding-ssh -i ~/.ssh/id_ed25519 user@server

# 自定义 SSH 端口
ai-coding-ssh -P 2222 user@server

# 带 auth token（多人共用时）
ai-coding-ssh -t my-secret-token user@server

# 附加 SSH 参数（如端口转发）
ai-coding-ssh user@server -- -L 3000:localhost:3000

# 断开后保持代理运行（连接多台服务器时有用）
ai-coding-ssh -k user@server1
ai-coding-ssh --no-proxy user@server2  # 复用已有代理
```

### `ai-coding-ssh-install-remote`

在远程服务器上安装 Claude Code CLI。

```bash
# 在线安装
ai-coding-ssh-install-remote user@server

# 离线安装（打包本地 npm 包传过去）
ai-coding-ssh-install-remote --offline user@server
```

### 代理服务器（单独使用）

```bash
# 直接启动代理
node lib/proxy.mjs

# 自定义配置
node lib/proxy.mjs --port 9090 --token my-token --debug

# 统一网关模式（所有提供商路由到同一地址）
node lib/proxy.mjs --upstream https://api.aicoding.sh

# 健康检查
curl http://localhost:18080/__health

# 运行测试
npm test
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_CODING_SSH_PROXY_PORT` | 本地代理端口 | 18080 |
| `AI_CODING_SSH_REMOTE_PORT` | 远程隧道端口 | 18080 |
| `AI_CODING_SSH_PROXY_TOKEN` | 代理鉴权 token | 无 |
| `PROXY_UPSTREAM` | 统一网关地址（覆盖所有提供商路由） | 无 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 无（自动传递到远程） |
| `GEMINI_API_KEY` | Google Gemini API Key | 无（自动传递到远程） |
| `OPENAI_API_KEY` | OpenAI API Key | 无（自动传递到远程） |

## 常见场景

### 场景 1：连接单台内网服务器

```bash
ai-coding-ssh dev@10.0.1.50
# 进去后直接用 claude
```

### 场景 2：连接多台服务器（共享一个代理）

```bash
# 终端 1：连第一台，-k 保持代理
ai-coding-ssh -k dev@server1

# 终端 2：连第二台，--no-proxy 复用代理
ai-coding-ssh --no-proxy dev@server2
```

### 场景 3：跳板机（多跳 SSH）

```bash
# 通过跳板机连接目标服务器
ai-coding-ssh dev@target -- -J jump@bastion
```

### 场景 4：离线环境（完全无外网）

```bash
# 先离线安装 Claude Code
ai-coding-ssh-install-remote --offline dev@airgapped-server

# 然后正常连接
ai-coding-ssh dev@airgapped-server
```

## 故障排查

**代理启动失败：** 检查 `/tmp/ai-coding-ssh-proxy.log`

**远程 claude 报错 connection refused：** 确认隧道端口一致，`ss -tlnp | grep 18080` 检查

**SSE 流式不工作：** 确认 Node.js >= 18，代理默认关闭了 response buffering

**端口被占用：** 换一个端口 `ai-coding-ssh -p 19090 -r 19090 user@server`

## 致谢

本项目由 [Claude](https://claude.ai) AI 辅助开发，从架构设计、代码实现到文档撰写均在 AI 协作下完成。

## License

MIT
