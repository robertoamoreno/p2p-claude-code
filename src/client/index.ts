#!/usr/bin/env node
/**
 * P2P Claude Chat Client
 *
 * Usage:
 *   p2p-chat <pairing-url> [options]
 *   p2p-chat "p2p-claude://connect?code=..." -c ~/projects/myapp
 */

import { resolve } from 'node:path';

function parseArgs(args: string[]): { pairingUrl: string | null; directory: string; help: boolean } {
    let pairingUrl: string | null = null;
    let directory = process.cwd();
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-c' || arg === '-C' || arg === '--directory' || arg === '-d') {
            directory = args[++i] || '';
            if (!directory) {
                console.error('Missing directory path after ' + arg);
                process.exit(1);
            }
        } else if (arg === '-h' || arg === '--help') {
            help = true;
        } else if (!arg.startsWith('-')) {
            pairingUrl = arg;
        }
    }

    return { pairingUrl, directory: resolve(directory), help };
}

function showHelp(): void {
    console.log(`
P2P Claude Chat Client

Usage:
  p2p-chat <pairing-url> [options]

Options:
  -c, -C, --directory <path>  Working directory for Claude session
  -h, --help                  Show this help message

Example:
  p2p-chat "p2p-claude://connect?code=..." -c ~/projects/myapp

The pairing URL is displayed when the daemon starts.
`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const parsed = parseArgs(args);

    if (parsed.help || !parsed.pairingUrl) {
        showHelp();
        process.exit(parsed.help ? 0 : 1);
    }

    // Dynamic import to avoid loading React until needed
    const { runChat } = await import('./chat.js');
    await runChat(parsed.pairingUrl, parsed.directory);
}

main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
