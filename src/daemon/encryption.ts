/**
 * AES-256-GCM encryption for P2P RPC messages
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class Encryption {
    private key: Buffer;

    constructor(keyBase64: string) {
        this.key = Buffer.from(keyBase64, 'base64');
        if (this.key.length !== 32) {
            throw new Error(`Invalid key length: expected 32 bytes, got ${this.key.length}`);
        }
    }

    /**
     * Encrypt data to base64 string
     * Format: version(1) + nonce(12) + ciphertext + authTag(16)
     */
    encrypt(data: unknown): string {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
        const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Bundle: version byte + nonce + ciphertext + authTag
        const bundle = Buffer.alloc(1 + 12 + encrypted.length + 16);
        bundle.writeUInt8(0, 0); // Version 0
        nonce.copy(bundle, 1);
        encrypted.copy(bundle, 13);
        authTag.copy(bundle, 13 + encrypted.length);

        return bundle.toString('base64');
    }

    /**
     * Decrypt base64 string to data
     */
    decrypt<T = unknown>(encryptedBase64: string): T {
        const bundle = Buffer.from(encryptedBase64, 'base64');

        if (bundle.length < 29) {
            throw new Error('Encrypted bundle too short');
        }

        const version = bundle.readUInt8(0);
        if (version !== 0) {
            throw new Error(`Unknown encryption version: ${version}`);
        }

        const nonce = bundle.subarray(1, 13);
        const authTag = bundle.subarray(bundle.length - 16);
        const ciphertext = bundle.subarray(13, bundle.length - 16);

        const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        return JSON.parse(decrypted.toString('utf-8')) as T;
    }

    /**
     * Get the key as base64 string (for pairing code)
     */
    getKeyBase64(): string {
        return this.key.toString('base64');
    }
}

/**
 * Generate a new random 256-bit encryption key
 */
export function generateEncryptionKey(): string {
    return randomBytes(32).toString('base64');
}
