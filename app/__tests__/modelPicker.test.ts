import {
  effortDetents,
  detentForValue,
  nearestDetent,
  revalidateSelection,
} from '../src/components/modelPicker';

test('effortDetents preserves the advertised order', () => {
  expect(effortDetents(['low', 'medium', 'high'])).toEqual([
    'low',
    'medium',
    'high',
  ]);
});

test('detentForValue: unset/unknown → first detent', () => {
  const lv = ['low', 'high'];
  expect(detentForValue(lv, undefined)).toBe(0);
  expect(detentForValue(lv, 'high')).toBe(1);
  expect(detentForValue(lv, 'bogus')).toBe(0);
});

test('nearestDetent snaps and clamps', () => {
  expect(nearestDetent(0, 100, 3)).toBe(0);
  expect(nearestDetent(50, 100, 3)).toBe(1);
  expect(nearestDetent(99, 100, 3)).toBe(2);
  expect(nearestDetent(999, 100, 3)).toBe(2);
  expect(nearestDetent(-5, 100, 3)).toBe(0);
  expect(nearestDetent(10, 0, 3)).toBe(0);
  expect(nearestDetent(10, 100, 1)).toBe(0);
});

const catalog = {
  selectableHarnessIds: ['claude-code'],
  models: [{ id: 'm1', label: 'M1', reasoningLevels: [], options: [] }],
  reasoningLevels: ['low', 'high'],
};

test('revalidateSelection: all ok', () => {
  expect(
    revalidateSelection(
      { harness: 'claude-code', model: 'm1', reasoning: 'low' },
      catalog,
    ),
  ).toEqual({ agentOk: true, modelOk: true, effortOk: true });
});

test('revalidateSelection: gone model/agent/effort flagged, not replaced', () => {
  expect(
    revalidateSelection(
      { harness: 'gone', model: 'gone', reasoning: 'extreme' },
      catalog,
    ),
  ).toEqual({ agentOk: false, modelOk: false, effortOk: false });
});

test('revalidateSelection: unset fields are ok', () => {
  expect(revalidateSelection(undefined, catalog)).toEqual({
    agentOk: true,
    modelOk: true,
    effortOk: true,
  });
});
