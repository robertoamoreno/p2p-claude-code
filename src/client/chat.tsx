/**
 * Ink-based P2P Claude Chat UI
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { RpcClient, Encryption, parsePairingUrl, type ConnectionState } from './rpc.js';
import type { ClaudeMessage, ContentBlock, SessionOutput } from '../types.js';

interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
}

interface ChatAppProps {
    pairingUrl: string;
    directory: string;
}

function ChatApp({ pairingUrl, directory }: ChatAppProps) {
    const { exit } = useApp();
    const [status, setStatus] = useState<'connecting' | 'spawning' | 'ready' | 'error'>('connecting');
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [error, setError] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [client, setClient] = useState<RpcClient | null>(null);
    const [host, setHost] = useState<string>('unknown');
    const [reconnectCount, setReconnectCount] = useState(0);

    // Initialize connection
    useEffect(() => {
        let rpcClient: RpcClient | null = null;
        let pollInterval: NodeJS.Timeout | null = null;
        let mounted = true;
        let currentSessionId: string | null = null;

        async function spawnSession(): Promise<string | null> {
            if (!rpcClient || !mounted) return null;

            setStatus('spawning');

            try {
                const result = await rpcClient.call<{ type: string; sessionId?: string; errorMessage?: string }>(
                    'spawn-session',
                    { directory, sessionId: crypto.randomUUID() }
                );

                if (!mounted) return null;

                if (result.type === 'success' && result.sessionId) {
                    return result.sessionId;
                } else {
                    throw new Error(result.errorMessage || 'Failed to spawn session');
                }
            } catch (err) {
                if (!mounted) return null;
                setError((err as Error).message);
                setStatus('error');
                return null;
            }
        }

        async function init() {
            try {
                // Parse pairing URL
                const info = parsePairingUrl(pairingUrl);
                if (info.metadata?.host) {
                    setHost(info.metadata.host);
                }

                // Create client
                const encryption = new Encryption(info.dataKey);
                rpcClient = new RpcClient(info.dhtPublicKey, encryption);
                setClient(rpcClient);

                // Listen for connection state changes
                rpcClient.onConnectionChange((state) => {
                    if (!mounted) return;
                    setConnectionState(state);

                    if (state === 'connected') {
                        setReconnectCount(prev => prev + 1);

                        // Re-spawn session on reconnect (after initial connection)
                        if (currentSessionId) {
                            setMessages(prev => [...prev, {
                                role: 'system',
                                content: '🔄 Reconnected to server. Spawning new session...',
                                timestamp: Date.now()
                            }]);

                            spawnSession().then(newSessionId => {
                                if (newSessionId && mounted) {
                                    currentSessionId = newSessionId;
                                    setSessionId(newSessionId);
                                    setStatus('ready');
                                    setMessages(prev => [...prev, {
                                        role: 'system',
                                        content: '✅ New session ready.',
                                        timestamp: Date.now()
                                    }]);
                                }
                            });
                        }
                    } else if (state === 'disconnected' && currentSessionId) {
                        setMessages(prev => [...prev, {
                            role: 'system',
                            content: '⚠️ Connection lost. Attempting to reconnect...',
                            timestamp: Date.now()
                        }]);
                    }
                });

                // Connect
                await rpcClient.ensureConnected();
                if (!mounted) return;

                // Spawn initial session
                currentSessionId = await spawnSession();
                if (!currentSessionId) return;

                setSessionId(currentSessionId);
                setStatus('ready');

                // Start polling for output
                pollInterval = setInterval(async () => {
                    if (!rpcClient || !mounted || !currentSessionId) return;

                    // Skip polling if disconnected
                    if (rpcClient.getConnectionState() !== 'connected') return;

                    try {
                        const output = await rpcClient.call<{ messages: SessionOutput[] }>(
                            'get-output',
                            { sessionId: currentSessionId, clear: true },
                            5000
                        );

                        if (output.messages?.length > 0) {
                            for (const msg of output.messages) {
                                if (msg.type === 'session-output' && msg.data.type === 'assistant') {
                                    const content = extractContent(msg.data);
                                    if (content) {
                                        setMessages(prev => [...prev, {
                                            role: 'assistant',
                                            content,
                                            timestamp: Date.now()
                                        }]);
                                        setIsThinking(false);
                                    }

                                    const tools = extractToolUse(msg.data);
                                    for (const tool of tools) {
                                        setMessages(prev => [...prev, {
                                            role: 'tool',
                                            content: tool,
                                            timestamp: Date.now()
                                        }]);
                                    }
                                }
                            }
                        }
                    } catch {
                        // Ignore polling errors
                    }
                }, 500);
            } catch (err) {
                if (!mounted) return;
                setError((err as Error).message);
                setStatus('error');
            }
        }

        init();

        return () => {
            mounted = false;
            if (pollInterval) clearInterval(pollInterval);
            if (rpcClient) rpcClient.destroy();
        };
    }, [pairingUrl, directory]);

    // Handle input submission
    const handleSubmit = useCallback(async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed || !client || !sessionId) return;

        // Handle commands
        if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
            try {
                await client.call('stop-session', { sessionId });
            } catch {
                // Ignore
            }
            exit();
            return;
        }

        // Add user message
        setMessages(prev => [...prev, {
            role: 'user',
            content: trimmed,
            timestamp: Date.now()
        }]);
        setInput('');
        setIsThinking(true);

        // Send to Claude
        try {
            await client.call('send-message', { sessionId, text: trimmed });
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'system',
                content: `Error: ${(err as Error).message}`,
                timestamp: Date.now()
            }]);
            setIsThinking(false);
        }
    }, [client, sessionId, exit]);

    // Handle Ctrl+C
    useInput((_, key) => {
        if (key.ctrl && key.return === false) {
            if (client && sessionId) {
                client.call('stop-session', { sessionId }).catch(() => {});
            }
            exit();
        }
    });

    // Render status screens
    if (status === 'connecting') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="cyan" bold>P2P Claude Code Chat</Text>
                <Text color="gray">Connecting to {host}...</Text>
            </Box>
        );
    }

    if (status === 'spawning') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="cyan" bold>P2P Claude Code Chat</Text>
                <Text color="gray">Spawning Claude session...</Text>
                <Text color="gray" dimColor>Directory: {directory}</Text>
            </Box>
        );
    }

    if (status === 'error') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="red" bold>Connection Error</Text>
                <Text color="red">{error}</Text>
            </Box>
        );
    }

    // Connection status indicator
    const connectionIndicator = connectionState === 'connected'
        ? <Text color="green">●</Text>
        : connectionState === 'connecting'
            ? <Text color="yellow">◐</Text>
            : <Text color="red">○</Text>;

    // Main chat UI
    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text color="cyan" bold>P2P Claude Code Chat</Text>
                <Text color="gray"> </Text>
                {connectionIndicator}
                <Text color="gray"> • </Text>
                <Text color="gray">{host}</Text>
                <Text color="gray"> • </Text>
                <Text color="gray" dimColor>{directory}</Text>
            </Box>

            {/* Messages */}
            <Box flexDirection="column" marginBottom={1}>
                {messages.slice(-20).map((msg, i) => (
                    <Box key={i} marginBottom={0}>
                        {msg.role === 'user' && (
                            <Text>
                                <Text color="green" bold>You: </Text>
                                <Text>{msg.content}</Text>
                            </Text>
                        )}
                        {msg.role === 'assistant' && (
                            <Text>
                                <Text color="blue" bold>Claude: </Text>
                                <Text>{msg.content}</Text>
                            </Text>
                        )}
                        {msg.role === 'tool' && (
                            <Text color="magenta" dimColor>[Tool: {msg.content}]</Text>
                        )}
                        {msg.role === 'system' && (
                            <Text color="yellow">{msg.content}</Text>
                        )}
                    </Box>
                ))}
                {isThinking && (
                    <Text color="gray" dimColor>Claude is thinking...</Text>
                )}
            </Box>

            {/* Input */}
            <Box>
                <Text color="green" bold>&gt; </Text>
                <TextInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    placeholder="Type a message..."
                />
            </Box>

            {/* Help */}
            <Box marginTop={1}>
                <Text color="gray" dimColor>/quit to exit • Ctrl+C to cancel</Text>
            </Box>
        </Box>
    );
}

function extractContent(message: ClaudeMessage): string | null {
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

function extractToolUse(message: ClaudeMessage): string[] {
    if (!message.message?.content) return [];
    if (typeof message.message.content === 'string') return [];

    return (message.message.content as ContentBlock[])
        .filter((block): block is ContentBlock & { name: string } =>
            block.type === 'tool_use' && typeof block.name === 'string'
        )
        .map(block => block.name);
}

// CLI entry point
export async function runChat(pairingUrl: string, directory: string): Promise<void> {
    const { waitUntilExit } = render(
        <ChatApp pairingUrl={pairingUrl} directory={directory} />
    );
    await waitUntilExit();
}
