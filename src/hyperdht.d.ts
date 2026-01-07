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
    }

    interface DhtServer extends EventEmitter {
        listen(keyPair: KeyPair): Promise<void>;
        close(): Promise<void>;
        address(): { publicKey: Buffer };
    }

    class DHT {
        constructor(options?: { bootstrap?: string[] });

        static keyPair(seed?: Buffer): KeyPair;

        createServer(onConnection?: (socket: DhtSocket) => void): DhtServer;
        connect(publicKey: Buffer): DhtSocket;
        destroy(): Promise<void>;
    }

    export default DHT;
    export { DHT, KeyPair, DhtSocket, DhtServer };
}
