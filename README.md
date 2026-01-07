# P2P Claude Code

A minimal P2P daemon that connects to Claude Code via HyperDHT, enabling remote control of Claude sessions from anywhere without a central server.

## Features

- **Serverless** - Direct P2P connection via HyperDHT
- **Encrypted** - AES-256-GCM encryption for all messages
- **Persistent** - Keys are saved, pairing URL stays the same across restarts
- **Simple** - ~800 lines of TypeScript, minimal dependencies

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  P2P Client (Ink TUI)                                                       │
│  └── React-based terminal UI                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (HyperDHT + AES-256-GCM)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Daemon                                                                     │
│  └── DHT Server → RPC Handler → Session Manager                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (stdio pipes, stream-json)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Claude Code                                                                │
│  └── --output-format stream-json --input-format stream-json                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 20
- Claude Code CLI installed (`claude` command available)

### Install & Build

```bash
git clone https://github.com/robertoamoreno/p2p-claude-code.git
cd p2p-claude-code
npm install
npm run build
```

### Start Daemon

```bash
node dist/index.js daemon
```

Output:
```
[Daemon] Generated new encryption key

P2P Claude Code Daemon
======================

DHT Public Key:
  bvCkFn3BMBX62EIPROqnyBLmYTQC4XpK7bZ9IsFTcWw=

Pairing URL:
  p2p-claude://connect?code=eyJ2IjoxLC...

Waiting for connections...
```

### Connect with Client

In another terminal (can be on a different machine):

```bash
node dist/client/index.js "p2p-claude://connect?code=eyJ2IjoxLC..." -c ~/projects/myapp
```

Options:
- `-c, --directory <path>` - Working directory for Claude session
- `-h, --help` - Show help

## Data Storage

Keys are stored in `~/.p2p-claude/`:

```
~/.p2p-claude/
├── dht-keypair.json    # DHT identity (public/secret key)
└── encryption.key      # AES-256 encryption key
```

**Important:** Never share these files. The pairing URL contains the encryption key.

## Security

| Aspect | Implementation |
|--------|----------------|
| Encryption | AES-256-GCM for all RPC messages |
| Key Exchange | Embedded in pairing URL |
| Authentication | Possession of pairing URL = full access |
| Network | HyperDHT (no central server) |

**Note:** Anyone with the pairing URL has full access to spawn Claude sessions on your machine. Keep it private.

## RPC Methods

| Method | Description |
|--------|-------------|
| `spawn-session` | Create new Claude session |
| `send-message` | Send user message to session |
| `get-output` | Get buffered Claude output |
| `stop-session` | Stop a session |
| `list-sessions` | List active sessions |
| `ping` | Test connectivity |

## Project Structure

```
p2p-claude-code/
├── src/
│   ├── index.ts              # Daemon CLI entry point
│   ├── types.ts              # Shared type definitions
│   ├── daemon/
│   │   ├── daemon.ts         # Main daemon logic
│   │   ├── dht.ts            # HyperDHT server
│   │   └── encryption.ts     # AES-256-GCM encryption
│   ├── claude/
│   │   └── query.ts          # Claude Code process spawning
│   └── client/
│       ├── index.ts          # Client CLI entry point
│       ├── chat.tsx          # Ink React UI components
│       └── rpc.ts            # RPC client
├── bin/
│   ├── p2p-claude.mjs        # Daemon bin wrapper
│   └── p2p-chat.mjs          # Client bin wrapper
└── dist/                     # Compiled JavaScript
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `P2P_CLAUDE_DATA_DIR` | Data directory (default: `~/.p2p-claude`) |
| `DEBUG` | Enable debug logging |

## License

MIT
