/**
 * DHT RPC Client - maintains persistent connection
 */

import { randomUUID } from 'node:crypto';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import DHT from 'hyperdht';

/**
 * AES-256-GCM encryption
 */
export class Encryption {
    private key: Buffer;

    constructor(keyBase64: string) {
        this.key = Buffer.from(keyBase64, 'base64');
    }

    encrypt(data: unknown): string {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
        const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const bundle = Buffer.alloc(1 + 12 + encrypted.length + 16);
        bundle.writeUInt8(0, 0);
        nonce.copy(bundle, 1);
        encrypted.copy(bundle, 13);
        authTag.copy(bundle, 13 + encrypted.length);

        return bundle.toString('base64');
    }

    decrypt<T = unknown>(encryptedBase64: string): T {
        const bundle = Buffer.from(encryptedBase64, 'base64');
        if (bundle.length < 29) throw new Error('Bundle too short');
        if (bundle.readUInt8(0) !== 0) throw new Error('Unknown version');

        const nonce = bundle.subarray(1, 13);
        const authTag = bundle.subarray(bundle.length - 16);
        const ciphertext = bundle.subarray(13, bundle.length - 16);

        const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        return JSON.parse(decrypted.toString('utf-8')) as T;
    }
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
}

export class RpcClient {
    private dhtPublicKey: Buffer;
    private encryption: Encryption;
    private dht: InstanceType<typeof DHT>;
    private socket: ReturnType<InstanceType<typeof DHT>['connect']> | null = null;
    private connected = false;
    private pendingRequests = new Map<string, PendingRequest>();
    private buffer = '';
    private connectPromise: Promise<void> | null = null;

    constructor(dhtPublicKey: string, encryption: Encryption) {
        this.dhtPublicKey = Buffer.from(dhtPublicKey, 'base64');
        this.encryption = encryption;
        this.dht = new DHT();
    }

    async ensureConnected(): Promise<void> {
        if (this.connected && this.socket && !this.socket.destroyed) {
            return;
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = new Promise((resolve, reject) => {
            this.socket = this.dht.connect(this.dhtPublicKey);

            const onConnect = () => {
                this.connected = true;
                this.connectPromise = null;
                resolve();
            };

            this.socket.once('open', onConnect);
            this.socket.once('connect', onConnect);

            this.socket.on('error', (err: Error) => {
                if (!this.connected) {
                    this.connectPromise = null;
                    reject(err);
                }
                this.connected = false;
            });

            this.socket.on('close', () => {
                this.connected = false;
                for (const [, { reject }] of this.pendingRequests) {
                    reject(new Error('Connection closed'));
                }
                this.pendingRequests.clear();
            });

            this.socket.on('data', (chunk: Buffer) => {
                this.buffer += chunk.toString('utf8');
                this.processBuffer();
            });

            setTimeout(() => {
                if (!this.connected) {
                    this.connectPromise = null;
                    reject(new Error('Connection timeout'));
                }
            }, 10000);
        });

        return this.connectPromise;
    }

    private processBuffer(): void {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const response = JSON.parse(line);
                const pending = this.pendingRequests.get(response.id);
                if (pending) {
                    this.pendingRequests.delete(response.id);
                    clearTimeout(pending.timeoutId);

                    if (!response.ok) {
                        pending.reject(new Error(response.error || 'RPC failed'));
                    } else if (response.result) {
                        pending.resolve(this.encryption.decrypt(response.result));
                    } else {
                        pending.resolve({});
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
    }

    async call<T = unknown>(method: string, params: unknown, timeoutMs = 30000): Promise<T> {
        await this.ensureConnected();

        const requestId = randomUUID();
        const request = {
            id: requestId,
            method,
            params: this.encryption.encrypt(params)
        };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('Request timed out'));
            }, timeoutMs);

            this.pendingRequests.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeoutId
            });

            try {
                this.socket!.write(JSON.stringify(request) + '\n');
            } catch (err) {
                this.pendingRequests.delete(requestId);
                clearTimeout(timeoutId);
                reject(err);
            }
        });
    }

    async destroy(): Promise<void> {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        await this.dht.destroy();
    }
}

/**
 * Parse pairing URL
 */
export interface PairingInfo {
    dhtPublicKey: string;
    dataKey: string;
    metadata?: {
        host?: string;
        platform?: string;
        createdAt?: number;
    };
}

export function parsePairingUrl(input: string): PairingInfo {
    const prefixes = [
        'p2p-claude://connect?code=',
        'happy://p2p-machine?code='
    ];

    for (const prefix of prefixes) {
        if (input.startsWith(prefix)) {
            const code = input.replace(prefix, '');
            try {
                const decoded = JSON.parse(Buffer.from(code, 'base64').toString('utf-8'));
                return {
                    dhtPublicKey: decoded.dhtPublicKey,
                    dataKey: decoded.dataKey,
                    metadata: decoded.metadata
                };
            } catch (e) {
                throw new Error(`Failed to parse pairing URL: ${(e as Error).message}`);
            }
        }
    }

    throw new Error('Invalid pairing URL format');
}
