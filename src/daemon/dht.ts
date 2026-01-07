/**
 * HyperDHT server for P2P RPC
 */

import DHT from 'hyperdht';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RpcRequest, RpcResponse } from '../types.js';
import { Encryption } from './encryption.js';

export interface RpcHandler {
    (method: string, params: unknown): Promise<unknown>;
}

export interface DhtServerOptions {
    dataDir?: string;
    encryption: Encryption;
    onRequest: RpcHandler;
}

export class DhtServer {
    private dht: InstanceType<typeof DHT>;
    private server: ReturnType<InstanceType<typeof DHT>['createServer']> | null = null;
    private keyPair: { publicKey: Buffer; secretKey: Buffer };
    private encryption: Encryption;
    private onRequest: RpcHandler;
    private dataDir: string;

    constructor(options: DhtServerOptions) {
        this.encryption = options.encryption;
        this.onRequest = options.onRequest;
        this.dataDir = options.dataDir || join(homedir(), '.p2p-claude');
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
     * Stop the DHT server
     */
    async stop(): Promise<void> {
        if (this.server) {
            await this.server.close();
        }
        await this.dht.destroy();
    }
}
