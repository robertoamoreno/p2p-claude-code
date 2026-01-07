/**
 * Core types for P2P Claude Code daemon
 */

// RPC request from P2P client
export interface RpcRequest {
    id: string;
    method: string;
    params: string; // Encrypted JSON
}

// RPC response to P2P client
export interface RpcResponse {
    id: string;
    ok: boolean;
    result?: string; // Encrypted JSON
    error?: string;
}

// Session tracking
export interface TrackedSession {
    sessionId: string;
    pid: number;
    process: import('node:child_process').ChildProcess;
    outputBuffer: SessionOutput[];
    createdAt: number;
    directory: string;
}

// Output from Claude session
export interface SessionOutput {
    type: 'session-output';
    data: ClaudeMessage;
    timestamp: number;
}

// Claude SDK message types
export interface ClaudeMessage {
    type: 'assistant' | 'user' | 'result' | 'system';
    message?: {
        role: string;
        content: ContentBlock[] | string;
    };
    subtype?: string;
    name?: string;
    result?: unknown;
}

export interface ContentBlock {
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    name?: string;
    id?: string;
    input?: unknown;
}

// Permission modes for Claude
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

// Spawn session options
export interface SpawnSessionOptions {
    directory: string;
    sessionId?: string;
    permissionMode?: PermissionMode;
    model?: string;
}

// Spawn session result
export type SpawnSessionResult =
    | { type: 'success'; sessionId: string; pid: number }
    | { type: 'error'; errorMessage: string };

// Send message options
export interface SendMessageOptions {
    sessionId: string;
    text: string;
}

// Send message result
export interface SendMessageResult {
    success: boolean;
    error?: string;
}

// Get output options
export interface GetOutputOptions {
    sessionId: string;
    clear?: boolean;
}

// Get output result
export interface GetOutputResult {
    messages: SessionOutput[];
}

// Pairing code payload
export interface PairingPayload {
    v: number;
    dhtPublicKey: string;
    dataKey: string;
    metadata: {
        host: string;
        platform: string;
        createdAt: number;
        rootDir?: string; // If set, sessions are restricted to this directory
    };
}
