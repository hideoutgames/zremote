import type {
  SessionCommandEntry,
  UserInputAnswer,
} from '../../zeron/protocol/types';

/** Latest respondInput payload for a question request. */
export const inputAnswers = (
  commands: readonly SessionCommandEntry[],
  requestId: string,
): UserInputAnswer[] => {
  for (let i = commands.length - 1; i >= 0; i--) {
    const command = commands[i];
    if (command.kind !== 'respondInput') continue;
    const payload = command.payload;
    if (payload.kind === 'respondInput' && payload.requestId === requestId) {
      return payload.answers;
    }
  }
  return [];
};
