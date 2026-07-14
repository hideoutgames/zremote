import {useCallback, useRef, useState} from 'react';
import {Alert} from 'react-native';
import {
  buildFunctionCallOutput,
  buildResponseCreate,
  parseServerEvent,
} from '../openai/protocol';
import {useOpenAIConnection} from '../openai/useOpenAIConnection';
import {searchMargeloKb} from '../rag/searchKnowledgeBase';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'done' | 'error';

// A picked image: `uri` is the local file (for display), `dataUrl` is the
// base64 data URL sent to OpenAI.
export type Attachment = {uri: string; dataUrl: string};

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  statusLabel?: string;
  attachments?: string[];
  reasoning?: string;
};

let messageCounter = 0;
const nextMessageId = (): string => `m${++messageCounter}`;

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);


  const previousResponseIdRef = useRef<string | undefined>(undefined);
  const streamingIdRef = useRef<string | null>(null);
  const pendingToolCallRef = useRef<{
    callId: string;
    name: string;
    args: string;
  } | null>(null);
  const toolCallCountRef = useRef(0);
  const sendPayloadRef = useRef<((payload: string) => boolean) | null>(null);

  const appendDelta = useCallback((text: string) => {
    const id = streamingIdRef.current;
    if (!id) {
      return;
    }
    setMessages(prev =>
      prev.map(m => (m.id === id ? {...m, text: m.text + text} : m)),
    );
  }, []);

  const appendReasoning = useCallback((text: string) => {
    const id = streamingIdRef.current;
    if (!id) {
      return;
    }
    setMessages(prev =>
      prev.map(m =>
        m.id === id ? {...m, reasoning: (m.reasoning ?? '') + text} : m,
      ),
    );
  }, []);

  const setStatusLabel = useCallback((label: string) => {
    const id = streamingIdRef.current;
    if (!id) {
      return;
    }
    setMessages(prev =>
      prev.map(m => (m.id === id ? {...m, statusLabel: label} : m)),
    );
  }, []);

  const finishStreaming = useCallback((status: MessageStatus) => {
    const id = streamingIdRef.current;
    if (!id) {
      return;
    }
    setMessages(prev => prev.map(m => (m.id === id ? {...m, status} : m)));
    streamingIdRef.current = null;
  }, []);

  const MAX_TOOL_CALLS = 4;
  const runToolCall = useCallback(
    async (
      toolCall: {callId: string; name: string; args: string},
      responseId: string,
    ) => {
      toolCallCountRef.current += 1;
      let output: string;
      if (toolCall.name !== 'search_margelo_kb') {
        output = `Unknown tool: ${toolCall.name}`;
      } else if (toolCallCountRef.current > MAX_TOOL_CALLS) {
        output = 'Tool call limit reached; answer from what you already have.';
      } else {
        try {
          const parsedArgs = JSON.parse(toolCall.args || '{}') as {
            query?: string;
          };
          const context = await searchMargeloKb(parsedArgs.query ?? '', 5);
          output =
            context || 'No matching Margelo knowledge base entries were found.';
        } catch (error) {
          output = `Knowledge base search failed: ${String(error)}`;
        }
      }
      const send = sendPayloadRef.current;
      const sent = send
        ? send(buildFunctionCallOutput(toolCall.callId, output, responseId))
        : false;
      if (!sent) {
        finishStreaming('error');
        Alert.alert(
          'Not connected',
          'Lost the connection while answering. Please try again.',
        );
      }
    },
    [finishStreaming],
  );

  const handleServerEvent = useCallback(
    (raw: string) => {
      const parsed = parseServerEvent(raw);
      switch (parsed.kind) {
        case 'status':
          setStatusLabel(parsed.label);
          break;
        case 'delta':
          appendDelta(parsed.text);
          break;
        case 'reasoning':
          appendReasoning(parsed.text);
          break;
        case 'tool_call':
          pendingToolCallRef.current = {
            callId: parsed.callId,
            name: parsed.name,
            args: parsed.args,
          };
          setStatusLabel('Searching Margelo docs');
          break;
        case 'completed': {
          const toolCall = pendingToolCallRef.current;
          if (toolCall) {
            pendingToolCallRef.current = null;
            runToolCall(toolCall, parsed.responseId);
            break;
          }
          if (parsed.responseId) {
            previousResponseIdRef.current = parsed.responseId;
          }
          finishStreaming('done');
          break;
        }
        case 'error':
          console.warn('[openai] error event:', parsed.message);
          // A failed turn evicts previous_response_id server-side, so drop it or every following send wedges.
          previousResponseIdRef.current = undefined;
          finishStreaming('error');
          Alert.alert('Something went wrong', parsed.message);
          break;
        case 'ignored':
          // Ignore benign non-JSON frames
          if (parsed.type !== '<unparseable>') {
            console.log('[openai] event:', parsed.type);
          }
          break;
      }
    },
    [appendDelta, appendReasoning, finishStreaming, runToolCall, setStatusLabel],
  );

  // previous_response_id lives only in the closed connection's cache, so drop it on disconnect.
  const handleDisconnect = useCallback(() => {
    previousResponseIdRef.current = undefined;
  }, []);

  const {send: sendPayload} = useOpenAIConnection({
    onServerEvent: handleServerEvent,
    onDisconnect: handleDisconnect,
  });
  sendPayloadRef.current = sendPayload;

  const send = useCallback(
    (rawText: string, attachments: Attachment[] = []) => {
      const text = rawText.trim();
      if (!text && attachments.length === 0) {
        return;
      }

      const sent = sendPayload(
        buildResponseCreate(
          text,
          previousResponseIdRef.current,
          attachments.map(a => a.dataUrl),
        ),
      );
      if (!sent) {
        Alert.alert(
          'Not connected',
          'Still connecting to the server. Please try again in a moment.',
        );
        return;
      }

      pendingToolCallRef.current = null;
      toolCallCountRef.current = 0;

      const userMessage: Message = {
        id: nextMessageId(),
        role: 'user',
        text,
        status: 'done',
        attachments: attachments.length
          ? attachments.map(a => a.uri)
          : undefined,
      };
      const assistantMessage: Message = {
        id: nextMessageId(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        statusLabel: 'Thinking',
      };
      streamingIdRef.current = assistantMessage.id;
      setMessages(prev => [...prev, userMessage, assistantMessage]);
    },
    [sendPayload],
  );

  // stop assistant message mid-stream
  const stop = useCallback(() => {
    finishStreaming('done');
  }, [finishStreaming]);

  const newChat = useCallback(() => {
    previousResponseIdRef.current = undefined;
    streamingIdRef.current = null;
    pendingToolCallRef.current = null;
    toolCallCountRef.current = 0;
    setMessages([]);
  }, []);

  return {messages, send, stop, newChat};
}
