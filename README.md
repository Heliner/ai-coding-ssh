# claude-ssh-proxy

在**无公网 IP、无外网**的内网 Linux 服务器上使用 Claude Code CLI。

通过 SSH 反向隧道，将本地 Mac 上的 API 代理端口"带入"远程服务器，让远程的 Claude Code 直接通过 `localhost` 访问 Anthropic API。

## 特性

- **零编译，纯源码** — 全部由 Shell 脚本 + Node.js 源码组成，没有任何二进制文件，可直接阅读、修改和审计
- **一条命令连接** — `claude-ssh user@server` 自动完成代理启动、SSH 隧道建立、远程环境变量配置
- **SSE 流式支持** — 代理层完整透传 Server-Sent Events，Claude Code 的流式输出不受影响
- **多服务器复用** — 一个代理实例可同时服务多条 SSH 隧道
- **可选鉴权** — 支持 token 认证，适合团队共用场景
- **离线安装** — 支持在无外网的服务器上离线安装 Claude Code CLI

## 原理

```
远程内网服务器                     开发者 Mac
┌─────────────────────┐           ┌──────────────────────┐
│  Claude Code CLI    │           │  API Proxy (:18080)  │
│    ↓                │           │    ↓                 │
│  localhost:18080  ──┼── SSH-R ──┼→ 127.0.0.1:18080     │
│                     │  tunnel   │    ↓                 │
└─────────────────────┘           │  api.anthropic.com   │
                                  └──────────────────────┘
```

开发者通过 SSH 连接远程服务器时，利用 SSH 的 `-R`（反向端口转发）功能，将本地代理端口映射到远程服务器的 `localhost:18080`。远程的 Claude Code CLI 通过 `ANTHROPIC_BASE_URL` 环境变量指向该地址，所有 API 请求经 SSH 隧道回传到本地代理，再由代理转发至 Anthropic API。

## 项目结构

```
claude-ssh-proxy/
├── bin/
│   ├── claude-ssh                 # 核心连接脚本（Bash）
│   └── claude-ssh-install-remote  # 远程安装辅助脚本（Bash）
├── lib/
│   └── proxy.mjs                  # API 代理服务器（Node.js, 纯源码）
├── setup.sh                       # 本地一键安装脚本
├── package.json
├── LICENSE
└── README.md
```

所有代码均为**可读的源码文件**，不包含任何编译产物或二进制依赖。Shell 脚本直接执行，Node.js 代理为单文件 ES Module，无需 `npm install`。

## 快速开始

### 1. 安装（在 Mac 上）

```bash
git clone https://github.com/Heliner/claude-ssh-proxy.git
cd claude-ssh-proxy
bash setup.sh
```

或者直接使用，无需安装：

```bash
# 直接从项目目录运行
./bin/claude-ssh user@server
```

### 2. 在远程服务器安装 Claude Code

```bash
# 在线安装（远程服务器需要能访问 npm registry）
claude-ssh --install-remote user@server

# 离线安装（远程服务器无外网）
claude-ssh-install-remote --offline user@server
```

### 3. 连接并使用

```bash
claude-ssh user@server
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

### `claude-ssh`

核心命令。自动启动本地代理 → SSH 连接 → 建立反向隧道 → 配置远程环境变量。

```bash
# 基本用法
claude-ssh user@192.168.1.100

# 自定义端口
claude-ssh -p 9090 -r 9090 user@server

# 使用 SSH 密钥
claude-ssh -i ~/.ssh/id_ed25519 user@server

# 自定义 SSH 端口
claude-ssh -P 2222 user@server

# 带 auth token（多人共用时）
claude-ssh -t my-secret-token user@server

# 附加 SSH 参数（如端口转发）
claude-ssh user@server -- -L 3000:localhost:3000

# 断开后保持代理运行（连接多台服务器时有用）
claude-ssh -k user@server1
claude-ssh --no-proxy user@server2  # 复用已有代理
```

### `claude-ssh-install-remote`

在远程服务器上安装 Claude Code CLI。

```bash
# 在线安装
claude-ssh-install-remote user@server

# 离线安装（打包本地 npm 包传过去）
claude-ssh-install-remote --offline user@server
```

### 代理服务器（单独使用）

```bash
# 直接启动代理
node lib/proxy.mjs

# 自定义配置
node lib/proxy.mjs --port 9090 --token my-token --debug

# 健康检查
curl http://localhost:18080/__health
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAUDE_SSH_PROXY_PORT` | 本地代理端口 | 18080 |
| `CLAUDE_SSH_REMOTE_PORT` | 远程隧道端口 | 18080 |
| `CLAUDE_SSH_PROXY_TOKEN` | 代理鉴权 token | 无 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 无（自动传递到远程） |

## 常见场景

### 场景 1：连接单台内网服务器

```bash
claude-ssh dev@10.0.1.50
# 进去后直接用 claude
```

### 场景 2：连接多台服务器（共享一个代理）

```bash
# 终端 1：连第一台，-k 保持代理
claude-ssh -k dev@server1

# 终端 2：连第二台，--no-proxy 复用代理
claude-ssh --no-proxy dev@server2
```

### 场景 3：跳板机（多跳 SSH）

```bash
# 通过跳板机连接目标服务器
claude-ssh dev@target -- -J jump@bastion
```

### 场景 4：离线环境（完全无外网）

```bash
# 先离线安装 Claude Code
claude-ssh-install-remote --offline dev@airgapped-server

# 然后正常连接
claude-ssh dev@airgapped-server
```

## 故障排查

**代理启动失败：** 检查 `/tmp/claude-ssh-proxy.log`

**远程 claude 报错 connection refused：** 确认隧道端口一致，`ss -tlnp | grep 18080` 检查

**SSE 流式不工作：** 确认 Node.js >= 18，代理默认关闭了 response buffering

**端口被占用：** 换一个端口 `claude-ssh -p 19090 -r 19090 user@server`

## License

MIT
