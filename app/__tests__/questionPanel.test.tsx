// QuestionPanel: option toggling (single vs multiSelect) and the submit
// payload shape {questionId, labels}.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { QuestionPanel } from '../src/components/agentsKit/QuestionPanel';
import type { UserInputQuestion } from '../src/zeron/protocol/types';

const questions: UserInputQuestion[] = [
  {
    id: 'q-sync',
    header: 'Question',
    question: 'Which sync strategy?',
    options: ['Poll', 'Events', 'Hybrid'],
    multiSelect: false,
  },
  {
    id: 'q-gates',
    header: 'Question',
    question: 'Which suites gate?',
    options: ['Unit', 'E2E', 'Golden'],
    multiSelect: true,
  },
];

const press = async (root: TestRenderer.ReactTestInstance, label: string) => {
  // RN 0.86's Pressable is a memo object — match by onPress + label text.
  const target = root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(p => p.findAllByType(Text).some(t => t.props.children === label));
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
};

test('multiSelect accumulates; single-select replaces; submit payload', async () => {
  const onSubmit = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <QuestionPanel
        requestId="r1"
        questions={questions}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
  });
  const root = tree!.root;

  // single-select: pick Poll then switch to Events
  await press(root, 'Poll');
  await press(root, 'Events');
  // multi-select: toggle Unit + Golden
  await press(root, 'Unit');
  await press(root, 'Golden');
  await press(root, 'Submit');

  expect(onSubmit).toHaveBeenCalledWith('r1', [
    { questionId: 'q-sync', labels: ['Events'] },
    { questionId: 'q-gates', labels: ['Unit', 'Golden'] },
  ]);
});

test('multiSelect toggles an option off', async () => {
  const onSubmit = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <QuestionPanel
        requestId="r1"
        questions={questions}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
  });
  const root = tree!.root;
  await press(root, 'Poll'); // q-sync must be answered or Submit is disabled
  await press(root, 'Unit');
  await press(root, 'E2E');
  await press(root, 'Unit'); // toggles off
  await press(root, 'Submit');
  expect(onSubmit).toHaveBeenCalledWith('r1', [
    { questionId: 'q-sync', labels: ['Poll'] },
    { questionId: 'q-gates', labels: ['E2E'] },
  ]);
});

test('custom text alone can submit and is appended to labels', async () => {
  const onSubmit = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <QuestionPanel
        requestId="r1"
        questions={questions}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
  });
  const root = tree!.root;
  const inputs = root.findAllByType(TextInput);
  expect(inputs).toHaveLength(2);
  await act(async () => inputs[0].props.onChangeText('write my own'));
  await act(async () => inputs[1].props.onChangeText('also this'));
  await press(root, 'Submit');
  expect(onSubmit).toHaveBeenCalledWith('r1', [
    { questionId: 'q-sync', labels: ['write my own'] },
    { questionId: 'q-gates', labels: ['also this'] },
  ]);
});

test('dismiss fires onDismiss without submitting', async () => {
  const onSubmit = jest.fn();
  const onDismiss = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <QuestionPanel
        requestId="r1"
        questions={questions}
        onSubmit={onSubmit}
        onDismiss={onDismiss}
      />,
    );
  });
  await press(tree!.root, 'Dismiss');
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});
