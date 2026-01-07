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
    const daemon = new Daemon();
    await daemon.start();

    // Keep process alive
    await new Promise(() => {});
}

function showHelp(): void {
    console.log(`
P2P Claude Code Daemon

Usage:
  p2p-claude [command]

Commands:
  daemon    Start the P2P daemon (default)
  help      Show this help message

Environment Variables:
  P2P_CLAUDE_DATA_DIR    Data directory (default: ~/.p2p-claude)
  DEBUG                  Enable debug logging

Example:
  # Start the daemon
  p2p-claude daemon

  # Then use the pairing URL with p2p-chat.mjs to connect
`);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
