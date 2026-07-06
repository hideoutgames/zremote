import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {NitroWebSocket} from 'react-native-nitro-websockets';
import {OPENAI_API_KEY, OPENAI_WS_URL} from '../config';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

export type OpenAIConnectionHandlers = {
  onServerEvent: (raw: string) => void;
  onDisconnect: () => void;
};


type UseOpenAIConnectionResult = {
  connection: ConnectionStatus;
  send: (payload: string) => boolean;
};

export function useOpenAIConnection(
  {onServerEvent, onDisconnect}: OpenAIConnectionHandlers,
): UseOpenAIConnectionResult {
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<NitroWebSocket | null>(null);


  const handlersRef = useRef<OpenAIConnectionHandlers>({
    onServerEvent,
    onDisconnect,
  });
  handlersRef.current = {onServerEvent, onDisconnect};

  useEffect(() => {
    // The socket closes on idle / backgrounding / server timeout (a normal 1000
    // close), and the server caps a connection at 60 minutes. Reconnect with
    // backoff, and immediately on returning to the foreground.
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) {
        return;
      }
      const delay = Math.min(1000 * 2 ** attempts, 15000);
      attempts += 1;
      console.log('[ws] reconnecting in', delay, 'ms');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      setConnection('connecting');
      const socket = new NitroWebSocket(OPENAI_WS_URL, undefined, {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      });
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[ws] open');
        attempts = 0;
        setConnection('open');
      };
      socket.onclose = event => {
        console.warn('[ws] closed', event?.code, event?.reason);
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        handlersRef.current.onDisconnect();
        setConnection('closed');
        scheduleReconnect();
      };
      socket.onerror = error => {
        console.warn('[ws] error', error);
        handlersRef.current.onDisconnect();
        setConnection('error');
        scheduleReconnect();
      };
      socket.onmessage = (event: {data: string}) => {
        handlersRef.current.onServerEvent(event.data);
      };
    };

    connect();

    // Reconnect right away when the app returns to the foreground with no live
    // socket 
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active' && !disposed && socketRef.current == null) {
        attempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        connect();
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      appStateSub.remove();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);


  const send = useCallback((payload: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 'OPEN') {
      return false;
    }
    socket.send(payload);
    return true;
  }, []);

  return {connection, send};
}
