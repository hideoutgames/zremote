// Self-containment: expo-widgets stores the layout component's source and
// re-evaluates it inside the widget extension's JS context, where the only
// globals are ExpoWidgets.bundle's (@expo/ui components, modifiers, the jsx
// runtime stubs, React). A reference to anything else — a module-scope
// helper, an app import — throws there and the activity renders a red box.

jest.mock('expo-widgets', () => ({
  createLiveActivity: jest.fn(() => ({})),
}));
jest.mock(
  '@expo/ui/swift-ui',
  () => ({
    HStack: 'HStack',
    Image: 'Image',
    ProgressView: 'ProgressView',
    Spacer: 'Spacer',
    Text: 'Text',
    VStack: 'VStack',
  }),
  { virtual: true },
);
jest.mock(
  '@expo/ui/swift-ui/modifiers',
  () => ({
    font: jest.fn(),
    foregroundStyle: jest.fn(),
    padding: jest.fn(),
    progressViewStyle: jest.fn(),
    tint: jest.fn(),
  }),
  { virtual: true },
);

import { SessionActivityLayout } from '../SessionActivity';
import type { SessionActivityProps } from '../SessionActivity';

/** Identifiers the extension's JS context provides (ExpoWidgets.bundle's
 * globals, plus the jsx-runtime aliases either JSX transform emits). */
const EXTENSION_GLOBALS = new Set([
  // jsx runtime (automatic + classic aliases)
  'jsx',
  'jsxs',
  'jsxDEV',
  'Fragment',
  '_jsx',
  '_jsxs',
  '_jsxDEV',
  '_Fragment',
  '_jsxRuntime',
  'React',
  'ReactNative',
  '__expoWidgetRender',
  '__expoWidgetHandlePress',
  // @expo/ui/swift-ui components used by the layout
  'HStack',
  'VStack',
  'ZStack',
  'Text',
  'Image',
  'Spacer',
  'ProgressView',
  // @expo/ui/swift-ui/modifiers used by the layout
  'font',
  'foregroundStyle',
  'padding',
  'progressViewStyle',
  'tint',
  // ECMAScript intrinsics — present in any JSContext, always safe
  'undefined',
  'NaN',
  'Infinity',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'JSON',
  'Math',
  'Date',
  'Error',
]);

/** Stands in for every allowed global: callable (jsx runtime, modifiers)
 * and property-accessible (`_jsxRuntime.jsx`, `React.createElement`). */
const universalStub = new Proxy(() => true, {
  get: () => universalStub,
  apply: () => ({}),
});

/** A globals object where every lookup hits the proxy: allowed names get a
 * stub, anything else throws — exactly what an undeclared reference does in
 * the extension's JSContext. `with (globals)` scopes every free-variable
 * lookup of the stored source through it. */
const sandboxGlobals = (): object =>
  new Proxy(
    {},
    {
      // `layout`/`props` are the outer function's own bindings — let them
      // resolve normally; intercept every other name the source touches.
      has: (_target, key) => key !== 'layout' && key !== 'props',
      get: (_target, key) => {
        if (key === Symbol.unscopables) return undefined;
        const name = String(key);
        if (!EXTENSION_GLOBALS.has(name)) {
          throw new Error(`reference outside extension globals: ${name}`);
        }
        // JS intrinsics must behave like themselves (`x !== undefined`,
        // `Array.isArray`, …); only extension globals get the stub.
        if (name in globalThis) {
          return (globalThis as Record<string, unknown>)[name];
        }
        return universalStub;
      },
    },
  );

/** The source the extension evaluates: babel-preset-expo's widgets plugin
 * replaces a 'widget'-directed function with a string literal of its
 * regenerated source, so in a real bundle the import is already a string.
 * `String()` covers both that and a plain function (older transforms). */
const layoutSource = String(SessionActivityLayout);

/** Re-evaluates the component's stored source with only the extension
 * globals in scope and calls it with the given props. */
const renderInExtension = (props: SessionActivityProps): unknown =>
  // Re-creating the extension's eval of the stored layout source is the
  // point of this test.
  // eslint-disable-next-line no-new-func
  new Function(
    'globals',
    'props',
    `with (globals) {
      const layout = (${layoutSource});
      return layout(props, {});
    }`,
  )(sandboxGlobals(), props);

const baseProps: SessionActivityProps = {
  chatId: 'c1',
  title: 'Refactor auth',
  phase: 'working',
  phaseLabel: 'working',
  startedAt: 0,
  showContext: true,
  hostLabel: 'mac · zeron',
};

describe('SessionActivityLayout', () => {
  it('evaluates its stored source against only the extension globals', () => {
    const result = renderInExtension(baseProps) as Record<string, unknown>;
    for (const region of [
      'banner',
      'compactLeading',
      'compactTrailing',
      'minimal',
      'expandedCenter',
      'expandedTrailing',
    ]) {
      expect(result[region]).toBeTruthy();
    }
  });

  it('renders the overflow branch without external references', () => {
    const result = renderInExtension({
      ...baseProps,
      overflowTitles: ['a', 'b'],
    }) as Record<string, unknown>;
    expect(result.expandedCenter).toBeTruthy();
  });
});
