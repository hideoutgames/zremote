import {useEffect, useRef} from 'react';
import {connectionManager} from './connectionManager';

export type OpenAIConnectionHandlers = {
  onServerEvent: (raw: string) => void;
  onDisconnect: () => void;
};


export function useOpenAIConnection({
  onServerEvent,
  onDisconnect,
}: OpenAIConnectionHandlers): {send: (payload: string) => boolean} {
  const handlersRef = useRef<OpenAIConnectionHandlers>({
    onServerEvent,
    onDisconnect,
  });
  handlersRef.current = {onServerEvent, onDisconnect};

  useEffect(() => {
    const subscription = connectionManager.setHandlers({
      onServerEvent: raw => handlersRef.current.onServerEvent(raw),
      onDisconnect: () => handlersRef.current.onDisconnect(),
    });
    return () => subscription.remove();
  }, []);

  return {send: connectionManager.send};
}
