/**
 * HyperDHT server for P2P RPC
 */

import DHT from 'hyperdht';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { networkInterfaces } from 'node:os';
import type { RpcRequest, RpcResponse } from '../types.js';
import { Encryption } from './encryption.js';

export interface RpcHandler {
    (method: string, params: unknown): Promise<unknown>;
}

export interface DhtServerOptions {
    dataDir?: string;
    encryption: Encryption;
    onRequest: RpcHandler;
    refreshInterval?: number; // ms, default 60000 (1 minute)
}

export interface SessionState {
    sessionId: string;
    pid: number;
    createdAt: number;
    directory?: string;
}

export class DhtServer {
    private dht: InstanceType<typeof DHT>;
    private server: ReturnType<InstanceType<typeof DHT>['createServer']> | null = null;
    private keyPair: { publicKey: Buffer; secretKey: Buffer };
    private encryption: Encryption;
    private onRequest: RpcHandler;
    private dataDir: string;
    private refreshInterval: number;
    private refreshTimer: NodeJS.Timeout | null = null;
    private networkCheckTimer: NodeJS.Timeout | null = null;
    private lastNetworkSignature: string = '';

    constructor(options: DhtServerOptions) {
        this.encryption = options.encryption;
        this.onRequest = options.onRequest;
        this.dataDir = options.dataDir || join(homedir(), '.p2p-claude');
        this.refreshInterval = options.refreshInterval ?? 60000; // 1 minute default
        this.dht = new DHT();
        this.keyPair = this.loadOrCreateKeyPair();
    }

    /**
     * Load existing keypair or create new one
     */
    private loadOrCreateKeyPair(): { publicKey: Buffer; secretKey: Buffer } {
        const keyPairPath = join(this.dataDir, 'dht-keypair.json');

        if (existsSync(keyPairPath)) {
            try {
                const data = JSON.parse(readFileSync(keyPairPath, 'utf-8'));
                return {
                    publicKey: Buffer.from(data.publicKey, 'base64'),
                    secretKey: Buffer.from(data.secretKey, 'base64')
                };
            } catch {
                // Fall through to create new
            }
        }

        // Create new keypair
        const keyPair = DHT.keyPair(randomBytes(32));

        // Ensure data directory exists
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true });
        }

        // Save keypair
        writeFileSync(keyPairPath, JSON.stringify({
            publicKey: keyPair.publicKey.toString('base64'),
            secretKey: keyPair.secretKey.toString('base64')
        }, null, 2));

        return keyPair;
    }

    /**
     * Start the DHT server
     */
    async start(): Promise<void> {
        this.server = this.dht.createServer((socket) => {
            this.handleConnection(socket);
        });

        await this.server.listen(this.keyPair);

        // Initialize network signature for change detection
        this.lastNetworkSignature = this.getNetworkSignature();

        // Start periodic refresh timer
        this.startRefreshTimer();

        // Start network change detection
        this.startNetworkChangeDetection();

        console.log('[DHT] Server started with auto-refresh enabled');
    }

    /**
     * Start periodic refresh timer
     */
    private startRefreshTimer(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        this.refreshTimer = setInterval(() => {
            this.refresh();
        }, this.refreshInterval);
    }

    /**
     * Start network change detection (checks every 10 seconds)
     */
    private startNetworkChangeDetection(): void {
        if (this.networkCheckTimer) {
            clearInterval(this.networkCheckTimer);
        }

        this.networkCheckTimer = setInterval(() => {
            const currentSignature = this.getNetworkSignature();
            if (currentSignature !== this.lastNetworkSignature) {
                console.log('[DHT] Network change detected, refreshing...');
                this.lastNetworkSignature = currentSignature;
                this.refresh();
            }
        }, 10000); // Check every 10 seconds
    }

    /**
     * Get a signature of current network interfaces for change detection
     */
    private getNetworkSignature(): string {
        const interfaces = networkInterfaces();
        const addresses: string[] = [];

        for (const [name, nets] of Object.entries(interfaces)) {
            if (!nets) continue;
            for (const net of nets) {
                // Skip internal/loopback interfaces
                if (!net.internal && net.family === 'IPv4') {
                    addresses.push(`${name}:${net.address}`);
                }
            }
        }

        return addresses.sort().join('|');
    }

    /**
     * Refresh server announcement on the DHT
     * Call this when network conditions change (IP change, reconnect, etc.)
     */
    refresh(): void {
        if (this.server) {
            try {
                this.server.refresh();
                console.log('[DHT] Server refreshed');
            } catch (error) {
                console.error('[DHT] Refresh error:', error);
            }
        }
    }

    /**
     * Handle incoming DHT connection
     */
    private handleConnection(socket: ReturnType<InstanceType<typeof DHT>['connect']>): void {
        let buffer = '';

        socket.on('data', async (chunk: Buffer) => {
            buffer += chunk.toString('utf8');

            // Parse newline-delimited JSON
            while (true) {
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex === -1) break;

                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (!line) continue;

                try {
                    const request = JSON.parse(line) as RpcRequest;
                    const response = await this.handleRequest(request);
                    socket.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    const errorResponse: RpcResponse = {
                        id: 'unknown',
                        ok: false,
                        error: error instanceof Error ? error.message : 'Parse error'
                    };
                    socket.write(JSON.stringify(errorResponse) + '\n');
                }
            }
        });

        socket.on('error', () => {
            // Expected when client disconnects - don't log
        });
    }

    /**
     * Handle RPC request
     */
    private async handleRequest(request: RpcRequest): Promise<RpcResponse> {
        try {
            // Decrypt params
            const params = this.encryption.decrypt(request.params);

            // Call handler
            const result = await this.onRequest(request.method, params);

            // Encrypt result
            return {
                id: request.id,
                ok: true,
                result: this.encryption.encrypt(result)
            };
        } catch (error) {
            return {
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Get the DHT public key as base64
     */
    getPublicKeyBase64(): string {
        return this.keyPair.publicKey.toString('base64');
    }

    /**
     * Stop the DHT server with graceful shutdown
     */
    async stop(): Promise<void> {
        console.log('[DHT] Initiating graceful shutdown...');

        // Clear timers
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (this.networkCheckTimer) {
            clearInterval(this.networkCheckTimer);
            this.networkCheckTimer = null;
        }

        // Close server
        if (this.server) {
            await this.server.close();
            console.log('[DHT] Server closed');
        }

        // Graceful destroy - allows proper unannouncement from DHT
        // force: false means it will wait for pending operations and unannounce
        await this.dht.destroy({ force: false });
        console.log('[DHT] DHT destroyed gracefully');
    }

    // ========================================
    // Mutable Storage API
    // ========================================

    /**
     * Store session state in the DHT (mutable record)
     * This allows clients to discover session state even after reconnecting
     */
    async storeSessionState(sessions: SessionState[]): Promise<void> {
        try {
            const value = Buffer.from(JSON.stringify({
                sessions,
                updatedAt: Date.now()
            }));

            await this.dht.mutablePut(this.keyPair, value);
            console.log(`[DHT] Stored ${sessions.length} session(s) in DHT`);
        } catch (error) {
            console.error('[DHT] Failed to store session state:', error);
        }
    }

    /**
     * Retrieve session state from the DHT
     * Returns null if no state found or on error
     */
    async getSessionState(): Promise<{ sessions: SessionState[]; updatedAt: number } | null> {
        try {
            const result = await this.dht.mutableGet(this.keyPair.publicKey, { latest: true });

            if (!result?.value) {
                return null;
            }

            const data = JSON.parse(result.value.toString());
            console.log(`[DHT] Retrieved ${data.sessions?.length || 0} session(s) from DHT`);
            return data;
        } catch (error) {
            console.error('[DHT] Failed to get session state:', error);
            return null;
        }
    }

    /**
     * Clear session state from DHT (store empty state)
     */
    async clearSessionState(): Promise<void> {
        await this.storeSessionState([]);
    }

    /**
     * Store arbitrary data in DHT (immutable - content-addressed)
     * Returns the hash that can be used to retrieve it
     */
    async storeImmutable(data: unknown): Promise<string | null> {
        try {
            const value = Buffer.from(JSON.stringify(data));
            const result = await this.dht.immutablePut(value);
            const hash = result.hash.toString('hex');
            console.log(`[DHT] Stored immutable data: ${hash}`);
            return hash;
        } catch (error) {
            console.error('[DHT] Failed to store immutable data:', error);
            return null;
        }
    }

    /**
     * Retrieve immutable data by hash
     */
    async getImmutable(hash: string): Promise<unknown | null> {
        try {
            const result = await this.dht.immutableGet(Buffer.from(hash, 'hex'));
            if (!result?.value) {
                return null;
            }
            return JSON.parse(result.value.toString());
        } catch (error) {
            console.error('[DHT] Failed to get immutable data:', error);
            return null;
        }
    }
}
