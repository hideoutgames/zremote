import {
  loadTerminalTabs,
  resetTerminalTabsForTests,
  saveTerminalTabs,
} from '../src/zeron/terminal/sessions';
import { TerminalClient } from '../src/zeron/terminal/client';
import { AnsiScreen } from '../src/zeron/terminal/ansi';

afterEach(() => {
  resetTerminalTabsForTests();
});

test('save and load restore the same tab list per chat', () => {
  const tab = {
    client: { handle: { session: { id: 't1' } } } as unknown as TerminalClient,
    screen: new AnsiScreen(8, 4),
    exited: false,
  };
  saveTerminalTabs('c1', [tab]);
  expect(loadTerminalTabs('c1')).toEqual([tab]);
  expect(loadTerminalTabs('c2')).toEqual([]);
  saveTerminalTabs('c1', []);
  expect(loadTerminalTabs('c1')).toEqual([]);
});
