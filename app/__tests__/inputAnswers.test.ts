import { inputAnswers } from '../src/components/transcript/inputAnswers';
import type { SessionCommandEntry } from '../src/zeron/protocol/types';

test('inputAnswers returns the latest respondInput labels', () => {
  const commands: SessionCommandEntry[] = [
    {
      id: 'c1',
      kind: 'respondInput',
      payload: {
        kind: 'respondInput',
        requestId: 'req',
        answers: [{ questionId: 'q1', labels: ['old'] }],
      },
      issuedBy: 'd1',
      issuedAt: 1,
      status: 'applied',
    },
    {
      id: 'c2',
      kind: 'respondInput',
      payload: {
        kind: 'respondInput',
        requestId: 'req',
        answers: [{ questionId: 'q1', labels: ['new'] }],
      },
      issuedBy: 'd1',
      issuedAt: 2,
      status: 'applied',
    },
  ];
  expect(inputAnswers(commands, 'req')).toEqual([
    { questionId: 'q1', labels: ['new'] },
  ]);
  expect(inputAnswers(commands, 'other')).toEqual([]);
});
