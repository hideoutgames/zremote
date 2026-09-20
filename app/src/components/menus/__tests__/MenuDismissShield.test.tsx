import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MenuDismissShield } from '../MenuDismissShield';
import { menuClosed, menuOpened, resetMenuGate } from '../menuGate';

describe('MenuDismissShield', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      tree?.unmount();
      tree = undefined;
      resetMenuGate();
    });
  });

  it('mounts while the menu gate is open and unmounts when it closes', async () => {
    await act(async () => {
      tree = TestRenderer.create(<MenuDismissShield />);
    });
    expect(tree!.toJSON()).toBeNull();

    await act(async () => {
      menuOpened();
    });
    expect(
      tree!.root.findByProps({ testID: 'menu-dismiss-shield' }),
    ).toBeTruthy();

    await act(async () => {
      menuClosed();
    });
    expect(tree!.toJSON()).toBeNull();
  });

  it('stays mounted through pressIn after the gate closes, then unmounts on pressOut', async () => {
    await act(async () => {
      tree = TestRenderer.create(<MenuDismissShield />);
    });
    await act(async () => {
      menuOpened();
    });
    const shield = tree!.root.findByProps({ testID: 'menu-dismiss-shield' });
    await act(async () => {
      shield.props.onPressIn();
    });
    await act(async () => {
      menuClosed();
    });
    expect(
      tree!.root.findByProps({ testID: 'menu-dismiss-shield' }),
    ).toBeTruthy();

    await act(async () => {
      tree!.root
        .findByProps({ testID: 'menu-dismiss-shield' })
        .props.onPressOut();
    });
    expect(tree!.toJSON()).toBeNull();
  });
});
