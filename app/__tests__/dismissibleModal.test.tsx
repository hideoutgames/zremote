import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal } from 'react-native';
import { ImagePreviewModal } from '../src/components/ImagePreviewModal';
import { TrueSheet } from '../src/expoGo/shims/trueSheet';
import { ModelPickerSheet } from '../src/components/ModelPickerSheet';
import { RootPager } from '../src/screens/RootPager';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import {
  catalogStore,
  type DeviceCatalog,
} from '../src/zeron/state/catalogStore';
import { workspaceStore } from '../src/zeron/state/workspaceStore';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

beforeEach(() => {
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

test('image preview backdrop press dismisses', async () => {
  const onDismiss = jest.fn();
  const tree = await render(
    <ImagePreviewModal
      uri="file:///a.png"
      name="a.png"
      onDismiss={onDismiss}
    />,
  );
  const backdrop = tree.root.findByProps({
    testID: 'image-preview-backdrop',
  });
  await act(async () => {
    backdrop.props.onPress();
  });
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(onDismiss).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByType(Modal).props.onDismiss();
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('TrueSheet shim backdrop dismisses unless dismissible is false', async () => {
  const onDidDismiss = jest.fn();
  const open = await render(
    <TrueSheet onDidDismiss={onDidDismiss}>{null}</TrueSheet>,
  );
  const dismiss = open.root.findAll(
    n => n.props.accessibilityLabel === 'Dismiss',
  )[0];
  await act(async () => {
    dismiss.props.onPress();
  });
  expect(open.root.findByType(Modal).props.visible).toBe(false);
  expect(onDidDismiss).not.toHaveBeenCalled();
  await act(async () => {
    open.root.findByType(Modal).props.onDismiss();
  });
  expect(onDidDismiss).toHaveBeenCalledTimes(1);
  await act(async () => {
    open.unmount();
  });

  const locked = await render(
    <TrueSheet dismissible={false} onDidDismiss={onDidDismiss}>
      {null}
    </TrueSheet>,
  );
  const lockedDismiss = locked.root.findAll(
    n => n.props.accessibilityLabel === 'Dismiss',
  )[0];
  expect(lockedDismiss.props.onPress).toBeUndefined();
  await act(async () => {
    locked.unmount();
  });
});

test('iPad model picker formSheet Modal allows swipe / outside dismiss', async () => {
  const catalog: DeviceCatalog = {
    harnesses: [{ id: 'claude', name: 'Claude', reasoningLevels: [] } as never],
    modelsByHarness: { claude: [] },
    loading: false,
    loadedAt: Date.now(),
  };
  catalogStore.setState({ byDevice: { h1: catalog } });
  const onClose = jest.fn();
  const tree = await render(
    <ModelPickerSheet
      runtime={{} as never}
      chat={{
        id: 'c1',
        deviceId: 'h1',
        archived: false,
        createdAt: 0,
        config: { harness: 'claude', modelOptions: {} },
      }}
      phase="idle"
      formSheet
      onClose={onClose}
    />,
  );
  const modal = tree.root.findByType(Modal);
  expect(modal.props.allowSwipeDismissal).toBe(true);
  expect(typeof modal.props.onRequestClose).toBe('function');
  await act(async () => {
    modal.props.onRequestClose();
  });
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByType(Modal).props.onDismiss();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});

test('compact Settings Modal allows swipe / outside dismiss', async () => {
  const tree = await render(<RootPager requestedChat={null} />);
  const modal = tree.root.findByType(Modal);
  expect(modal.props.presentationStyle).toBe('pageSheet');
  expect(modal.props.allowSwipeDismissal).toBe(true);
  expect(typeof modal.props.onRequestClose).toBe('function');
  await act(async () => {
    tree.unmount();
  });
});

test('compact New thread opens a blank compose session', async () => {
  const tree = await render(<RootPager requestedChat={null} />);
  const btn = tree.root.findAll(n => n.props.testID === 'home-new-thread')[0];
  expect(btn).toBeDefined();
  await act(async () => {
    btn.props.onPress();
  });
  expect(
    tree.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBeGreaterThan(0);
  await act(async () => {
    tree.unmount();
  });
});
