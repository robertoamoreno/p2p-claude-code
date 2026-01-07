/**
 * Spawn and communicate with Claude Code process
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeMessage, ContentBlock } from '../types.js';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface QueryOptions {
    cwd: string;
    claudePath?: string;
    permissionMode?: PermissionMode;
    model?: string;
    maxTurns?: number;
}

export interface ClaudeSession {
    process: ChildProcess;
    sendMessage: (text: string) => void;
    onOutput: (callback: (message: ClaudeMessage) => void) => void;
    kill: () => void;
}

/**
 * Find the Claude Code executable
 */
function findClaudePath(): string {
    // Check common locations
    const locations = [
        // Global npm install
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        // User npm install
        join(process.env.HOME || '', '.npm-global/bin/claude'),
        join(process.env.HOME || '', 'node_modules/.bin/claude'),
    ];

    for (const loc of locations) {
        if (existsSync(loc)) {
            return loc;
        }
    }

    // Default to 'claude' command (assumes it's in PATH)
    return 'claude';
}

/**
 * Spawn a Claude Code session with stream-json mode
 */
export function spawnClaudeSession(options: QueryOptions): ClaudeSession {
    const claudePath = options.claudePath || findClaudePath();

    const args = [
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose'
    ];

    // Permission mode - default to acceptEdits for remote usage
    const permissionMode = options.permissionMode || 'acceptEdits';
    args.push('--permission-mode', permissionMode);

    if (options.model) {
        args.push('--model', options.model);
    }

    if (options.maxTurns) {
        args.push('--max-turns', options.maxTurns.toString());
    }

    console.log(`[Claude] Spawning: ${claudePath} ${args.join(' ')}`);
    console.log(`[Claude] CWD: ${options.cwd}`);
    console.log(`[Claude] Permission mode: ${permissionMode}`);

    const child = spawn(claudePath, args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            CLAUDE_CODE_ENTRYPOINT: 'p2p-daemon'
        },
        shell: process.platform === 'win32'
    });

    const outputCallbacks: Array<(message: ClaudeMessage) => void> = [];

    // Parse stdout for stream-json messages
    if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const message = JSON.parse(line) as ClaudeMessage;
                for (const callback of outputCallbacks) {
                    callback(message);
                }
            } catch {
                // Non-JSON output, ignore
                if (process.env.DEBUG) {
                    console.log('[Claude stdout]', line);
                }
            }
        });
    }

    // Log stderr
    if (child.stderr) {
        child.stderr.on('data', (data) => {
            if (process.env.DEBUG) {
                console.error('[Claude stderr]', data.toString());
            }
        });
    }

    child.on('exit', (code, signal) => {
        console.log(`[Claude] Process exited: code=${code}, signal=${signal}`);
    });

    child.on('error', (err) => {
        console.error('[Claude] Process error:', err);
    });

    return {
        process: child,

        sendMessage: (text: string) => {
            if (child.stdin && !child.stdin.destroyed) {
                const message = {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: text
                    }
                };
                child.stdin.write(JSON.stringify(message) + '\n');
            }
        },

        onOutput: (callback: (message: ClaudeMessage) => void) => {
            outputCallbacks.push(callback);
        },

        kill: () => {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
        }
    };
}

/**
 * Extract text from Claude message content
 */
export function extractText(message: ClaudeMessage): string | null {
    if (!message.message?.content) return null;

    const content = message.message.content;
    if (typeof content === 'string') return content;

    const textBlocks = (content as ContentBlock[])
        .filter((block): block is ContentBlock & { text: string } =>
            block.type === 'text' && typeof block.text === 'string'
        )
        .map(block => block.text);

    return textBlocks.length > 0 ? textBlocks.join('\n') : null;
}

/**
 * Extract tool use from Claude message
 */
export function extractToolUse(message: ClaudeMessage): Array<{ name: string; id: string }> {
    if (!message.message?.content) return [];
    if (typeof message.message.content === 'string') return [];

    return (message.message.content as ContentBlock[])
        .filter((block): block is ContentBlock & { name: string; id: string } =>
            block.type === 'tool_use' && typeof block.name === 'string'
        )
        .map(block => ({ name: block.name, id: block.id }));
}
