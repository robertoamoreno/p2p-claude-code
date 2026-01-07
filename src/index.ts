#!/usr/bin/env node
/**
 * P2P Claude Code CLI
 *
 * Commands:
 *   daemon  - Start the P2P daemon
 *   pair    - Show pairing URL (daemon must be running)
 */

import { Daemon } from './daemon/daemon.js';

const args = process.argv.slice(2);
const command = args[0];

// Parse --root-dir argument
function parseRootDir(): string | undefined {
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--root-dir' || args[i] === '-r') {
            return args[i + 1];
        }
        if (args[i].startsWith('--root-dir=')) {
            return args[i].split('=')[1];
        }
    }
    return undefined;
}

async function main(): Promise<void> {
    switch (command) {
        case 'daemon':
        case 'start':
        case undefined:
            await startDaemon();
            break;

        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;

        default:
            console.error(`Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

async function startDaemon(): Promise<void> {
    const rootDir = parseRootDir();

    if (rootDir) {
        console.log(`[Daemon] Root directory restriction: ${rootDir}`);
    }

    const daemon = new Daemon({ rootDir });
    await daemon.start();

    // Keep process alive
    await new Promise(() => {});
}

function showHelp(): void {
    console.log(`
P2P Claude Code Daemon

Usage:
  p2p-claude [command] [options]

Commands:
  daemon    Start the P2P daemon (default)
  help      Show this help message

Options:
  --root-dir, -r <path>  Restrict Claude sessions to this directory
                         Sessions cannot access files outside this path

Environment Variables:
  P2P_CLAUDE_DATA_DIR    Data directory (default: ~/.p2p-claude)
  DEBUG                  Enable debug logging

Examples:
  # Start the daemon (unrestricted)
  p2p-claude daemon

  # Start with directory restriction
  p2p-claude daemon --root-dir ~/projects

  # Then use the pairing URL with the client to connect
`);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
