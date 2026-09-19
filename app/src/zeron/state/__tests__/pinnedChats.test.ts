import { partitionPinnedChats } from '../pinnedChats';

const chat = (id: string) => ({ id });

describe('partitionPinnedChats', () => {
  it('returns pinned ids in prefs order and the rest in input order', () => {
    const chats = [chat('a'), chat('b'), chat('c'), chat('d')];
    expect(partitionPinnedChats(chats, ['c', 'a'])).toEqual({
      pinned: [{ id: 'c' }, { id: 'a' }],
      rest: [{ id: 'b' }, { id: 'd' }],
    });
  });

  it('skips pinned ids that are not in the list', () => {
    expect(partitionPinnedChats([chat('a')], ['missing', 'a'])).toEqual({
      pinned: [{ id: 'a' }],
      rest: [],
    });
  });

  it('returns everything as rest when nothing is pinned', () => {
    const chats = [chat('a'), chat('b')];
    expect(partitionPinnedChats(chats, [])).toEqual({
      pinned: [],
      rest: chats,
    });
  });
});
