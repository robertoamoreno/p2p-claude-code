/**
 * P2P Claude Code Daemon
 * Manages Claude sessions and exposes them via HyperDHT
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DhtServer } from './dht.js';
import { Encryption, generateEncryptionKey } from './encryption.js';
import { spawnClaudeSession, type ClaudeSession } from '../claude/query.js';
import type {
    TrackedSession,
    SessionOutput,
    SpawnSessionOptions,
    SpawnSessionResult,
    SendMessageOptions,
    SendMessageResult,
    GetOutputOptions,
    GetOutputResult,
    PairingPayload
} from '../types.js';

export interface DaemonOptions {
    dataDir?: string;
    encryptionKey?: string; // Base64, will generate if not provided
}

export class Daemon {
    private dhtServer: DhtServer;
    private encryption: Encryption;
    private sessions = new Map<string, TrackedSession>();
    private dataDir: string;

    constructor(options: DaemonOptions = {}) {
        this.dataDir = options.dataDir || process.env.P2P_CLAUDE_DATA_DIR || join(homedir(), '.p2p-claude');

        // Load or generate encryption key
        const encryptionKey = options.encryptionKey || this.loadOrCreateEncryptionKey();
        this.encryption = new Encryption(encryptionKey);

        this.dhtServer = new DhtServer({
            dataDir: this.dataDir,
            encryption: this.encryption,
            onRequest: this.handleRpcRequest.bind(this)
        });
    }

    /**
     * Load existing encryption key or create new one
     */
    private loadOrCreateEncryptionKey(): string {
        const keyPath = join(this.dataDir, 'encryption.key');

        // Ensure data directory exists
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true });
        }

        // Try to load existing key
        if (existsSync(keyPath)) {
            try {
                const data = JSON.parse(readFileSync(keyPath, 'utf-8'));
                if (data.key) {
                    console.log('[Daemon] Loaded existing encryption key');
                    return data.key;
                }
            } catch {
                // Fall through to create new
            }
        }

        // Generate new key
        const key = generateEncryptionKey();
        writeFileSync(keyPath, JSON.stringify({ key, createdAt: Date.now() }, null, 2));
        console.log('[Daemon] Generated new encryption key');
        return key;
    }

    /**
     * Start the daemon
     */
    async start(): Promise<void> {
        await this.dhtServer.start();

        const dhtPublicKey = this.dhtServer.getPublicKeyBase64();

        console.log('');
        console.log('P2P Claude Code Daemon');
        console.log('======================');
        console.log('');
        console.log('DHT Public Key:');
        console.log(`  ${dhtPublicKey}`);
        console.log('');
        console.log('Pairing URL:');
        console.log(`  ${this.getPairingUrl()}`);
        console.log('');
        console.log('Waiting for connections...');
        console.log('');

        // Handle shutdown
        const shutdown = async () => {
            console.log('\nShutting down...');
            await this.stop();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    /**
     * Stop the daemon
     */
    async stop(): Promise<void> {
        // Kill all sessions
        for (const [sessionId, session] of this.sessions) {
            console.log(`Stopping session ${sessionId}...`);
            session.process.kill('SIGTERM');
        }
        this.sessions.clear();

        await this.dhtServer.stop();
    }

    /**
     * Get the pairing URL containing all connection info
     */
    getPairingUrl(): string {
        const payload: PairingPayload = {
            v: 1,
            dhtPublicKey: this.dhtServer.getPublicKeyBase64(),
            dataKey: this.encryption.getKeyBase64(),
            metadata: {
                host: hostname(),
                platform: process.platform,
                createdAt: Date.now()
            }
        };

        const code = Buffer.from(JSON.stringify(payload)).toString('base64');
        return `p2p-claude://connect?code=${code}`;
    }

    /**
     * Handle incoming RPC request
     */
    private async handleRpcRequest(method: string, params: unknown): Promise<unknown> {
        console.log(`[RPC] ${method}`);

        switch (method) {
            case 'spawn-session':
                return this.spawnSession(params as SpawnSessionOptions);

            case 'send-message':
                return this.sendMessage(params as SendMessageOptions);

            case 'get-output':
                return this.getOutput(params as GetOutputOptions);

            case 'stop-session':
                return this.stopSession((params as { sessionId: string }).sessionId);

            case 'list-sessions':
                return this.listSessions();

            case 'ping':
                return { pong: true, timestamp: Date.now() };

            default:
                throw new Error(`Unknown method: ${method}`);
        }
    }

    /**
     * Spawn a new Claude session
     */
    private async spawnSession(options: SpawnSessionOptions): Promise<SpawnSessionResult> {
        const sessionId = options.sessionId || randomUUID();
        const permissionMode = options.permissionMode || 'acceptEdits';

        console.log(`[Session] Spawning ${sessionId} in ${options.directory}`);
        console.log(`[Session] Permission mode: ${permissionMode}`);

        try {
            const claudeSession = spawnClaudeSession({
                cwd: options.directory,
                permissionMode,
                model: options.model
            });

            const trackedSession: TrackedSession = {
                sessionId,
                pid: claudeSession.process.pid!,
                process: claudeSession.process,
                outputBuffer: [],
                createdAt: Date.now()
            };

            // Capture output
            claudeSession.onOutput((message) => {
                trackedSession.outputBuffer.push({
                    type: 'session-output',
                    data: message,
                    timestamp: Date.now()
                });

                // Limit buffer size
                if (trackedSession.outputBuffer.length > 1000) {
                    trackedSession.outputBuffer = trackedSession.outputBuffer.slice(-500);
                }
            });

            // Handle exit
            claudeSession.process.on('exit', () => {
                console.log(`[Session] ${sessionId} exited`);
                this.sessions.delete(sessionId);
            });

            this.sessions.set(sessionId, trackedSession);

            return {
                type: 'success',
                sessionId,
                pid: trackedSession.pid
            };
        } catch (error) {
            return {
                type: 'error',
                errorMessage: error instanceof Error ? error.message : 'Failed to spawn session'
            };
        }
    }

    /**
     * Send a message to a session
     */
    private async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
        const session = this.sessions.get(options.sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        try {
            const claudeSession = this.getClaudeSession(session);
            claudeSession.sendMessage(options.text);
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to send message'
            };
        }
    }

    /**
     * Get output from a session
     */
    private async getOutput(options: GetOutputOptions): Promise<GetOutputResult> {
        const session = this.sessions.get(options.sessionId);
        if (!session) {
            return { messages: [] };
        }

        const messages = [...session.outputBuffer];

        if (options.clear) {
            session.outputBuffer = [];
        }

        return { messages };
    }

    /**
     * Stop a session
     */
    private async stopSession(sessionId: string): Promise<{ success: boolean }> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false };
        }

        session.process.kill('SIGTERM');
        this.sessions.delete(sessionId);

        return { success: true };
    }

    /**
     * List all active sessions
     */
    private async listSessions(): Promise<Array<{ sessionId: string; pid: number; createdAt: number }>> {
        return Array.from(this.sessions.values()).map(session => ({
            sessionId: session.sessionId,
            pid: session.pid,
            createdAt: session.createdAt
        }));
    }

    /**
     * Get ClaudeSession interface from TrackedSession
     */
    private getClaudeSession(session: TrackedSession): ClaudeSession {
        return {
            process: session.process,
            sendMessage: (text: string) => {
                if (session.process.stdin && !session.process.stdin.destroyed) {
                    const message = {
                        type: 'user',
                        message: { role: 'user', content: text }
                    };
                    session.process.stdin.write(JSON.stringify(message) + '\n');
                }
            },
            onOutput: () => { /* Already set up */ },
            kill: () => session.process.kill('SIGTERM')
        };
    }
}
