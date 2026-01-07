/**
 * Type declarations for hyperdht
 */

declare module 'hyperdht' {
    import { EventEmitter } from 'node:events';
    import { Duplex } from 'node:stream';

    interface KeyPair {
        publicKey: Buffer;
        secretKey: Buffer;
    }

    interface DhtSocket extends Duplex {
        on(event: 'data', listener: (chunk: Buffer) => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        on(event: 'close', listener: () => void): this;
        on(event: 'open', listener: () => void): this;
        on(event: 'connect', listener: () => void): this;
        once(event: 'open', listener: () => void): this;
        once(event: 'connect', listener: () => void): this;
        write(data: string | Buffer): boolean;
        destroy(): void;
        destroyed: boolean;
        remotePublicKey: Buffer;
        publicKey: Buffer;
    }

    interface DhtServer extends EventEmitter {
        listen(keyPair: KeyPair): Promise<void>;
        close(): Promise<void>;
        address(): { publicKey: Buffer; host: string; port: number };
        refresh(): void;
    }

    interface DestroyOptions {
        force?: boolean;
    }

    interface MutableGetOptions {
        seq?: number;
        latest?: boolean;
    }

    interface MutableGetResult {
        value: Buffer | null;
        seq: number;
        signature: Buffer;
    }

    interface ImmutablePutResult {
        hash: Buffer;
    }

    interface ImmutableGetResult {
        value: Buffer | null;
    }

    class DHT {
        constructor(options?: {
            bootstrap?: string[];
            connectionKeepAlive?: number | false;
        });

        static keyPair(seed?: Buffer): KeyPair;
        static bootstrapper(port: number, host: string, options?: object): DHT;

        createServer(options?: { firewall?: (remotePublicKey: Buffer, payload?: Buffer) => boolean }, onConnection?: (socket: DhtSocket) => void): DhtServer;
        createServer(onConnection?: (socket: DhtSocket) => void): DhtServer;
        connect(publicKey: Buffer, options?: { keyPair?: KeyPair; nodes?: object[] }): DhtSocket;
        destroy(options?: DestroyOptions): Promise<void>;

        // Mutable storage (signed, versioned records)
        mutablePut(keyPair: KeyPair, value: Buffer, options?: { seq?: number }): Promise<{ seq: number }>;
        mutableGet(publicKey: Buffer, options?: MutableGetOptions): Promise<MutableGetResult | null>;

        // Immutable storage (content-addressed)
        immutablePut(value: Buffer): Promise<ImmutablePutResult>;
        immutableGet(hash: Buffer): Promise<ImmutableGetResult | null>;

        // Peer discovery
        lookup(topic: Buffer, options?: object): AsyncIterable<object>;
        announce(topic: Buffer, keyPair: KeyPair, relayAddresses?: object[], options?: object): AsyncIterable<object>;
        unannounce(topic: Buffer, keyPair: KeyPair, options?: object): Promise<void>;
    }

    export default DHT;
    export { DHT, KeyPair, DhtSocket, DhtServer, DestroyOptions, MutableGetOptions, MutableGetResult, ImmutablePutResult, ImmutableGetResult };
}
