// ⚠️ WRITTEN BUT UNVERIFIED — this spec has never been through codegen or
// Xcode. Do not enable AdaptiveShell's `useNativeSplitView` until the Mac
// checklist in docs/NATIVE_MODULES.md passes.
//
// Fabric spec for a UISplitViewController(style: .tripleColumn) whose three
// columns are RN child views, in order: sidebar / content / inspector.

/* eslint-disable @react-native/no-deep-imports -- codegen requires these */
import type { ViewProps } from 'react-native';
import type {
  BubblingEventHandler,
  Double,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import type { HostComponent } from 'react-native';

export type DisplayModeChangeEvent = {
  /** UISplitViewController.DisplayMode raw value. */
  displayMode: Double;
};

export interface NativeProps extends ViewProps {
  /** UISplitViewController.preferredDisplayMode (0=automatic …). */
  preferredDisplayMode?: WithDefault<Double, 0>;
  presentsWithGesture?: WithDefault<boolean, true>;
  onDisplayModeChange?: BubblingEventHandler<DisplayModeChangeEvent>;
}

interface NativeCommands {
  collapse(componentRef: React.ElementRef<ComponentType>): void;
  expand(componentRef: React.ElementRef<ComponentType>): void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['collapse', 'expand'],
});

type ComponentType = HostComponent<NativeProps>;

export default codegenNativeComponent<NativeProps>('ZeronSplitView');
