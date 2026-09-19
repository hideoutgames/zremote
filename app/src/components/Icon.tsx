import React, { type ComponentProps } from 'react';
import { type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'react-native-nitro-symbols';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import type { SFSymbol } from 'sf-symbols-typescript';
import { theme } from '../theme';

// Android has no SF Symbols, so SymbolView renders this fallback there (on iOS
// the real SF Symbol shows and the fallback is never displayed). Map each SF
// Symbol we use to the closest Material Design Icon.
const SF_TO_MDI: Record<string, string> = {
  'line.3.horizontal': 'menu',
  'square.and.pencil': 'square-edit-outline',
  'chevron.down': 'chevron-down',
  'chevron.right': 'chevron-right',
  'chevron.up.chevron.down': 'unfold-more-horizontal',
  plus: 'plus',
  'arrow.up': 'arrow-up',
  'arrow.down': 'arrow-down',
  'arrow.left': 'arrow-left',
  'arrow.right': 'arrow-right',
  'stop.fill': 'stop',
  sparkles: 'creation',
  'text.bubble': 'message-outline',
  clock: 'clock-outline',
  'square.on.square': 'content-copy',
  'square.and.arrow.up': 'export-variant',
  play: 'play',
  'hand.thumbsup': 'thumb-up-outline',
  'hand.thumbsdown': 'thumb-down-outline',
  'arrow.clockwise': 'refresh',
  safari: 'compass-outline',
  xmark: 'close',
  magnifyingglass: 'magnify',
  gearshape: 'cog-outline',
  camera: 'camera',
  photo: 'image',
  paperclip: 'paperclip',
  terminal: 'console',
  doc: 'file-document-outline',
  pencil: 'pencil',
  globe: 'earth',
  checklist: 'format-list-checks',
  'puzzlepiece.extension': 'puzzle-outline',
  wrench: 'wrench',
  'chevron.left': 'chevron-left',
  ellipsis: 'dots-horizontal',
  'ellipsis.circle': 'dots-horizontal-circle-outline',
  link: 'link',
  'checkmark.circle': 'check-circle-outline',
  'circle.fill': 'circle',
  'exclamationmark.triangle': 'alert-outline',
  'doc.on.doc': 'content-copy',
  'folder.fill': 'folder',
  shippingbox: 'cube-outline',
  'arrow.triangle.branch': 'source-branch',
  externaldrive: 'harddisk',
  'person.crop.circle': 'account-circle-outline',
  'rectangle.stack': 'cards-outline',
  'questionmark.circle': 'help-circle-outline',
  checkmark: 'check',
  'square.and.arrow.down': 'download-outline',
  archivebox: 'archive-outline',
  'chevron.up': 'chevron-up',
  folder: 'folder-outline',
  'arrow.up.doc': 'file-upload-outline',
  'doc.text': 'file-document-outline',
  eye: 'eye-outline',
  'eye.slash': 'eye-off-outline',
  lock: 'lock-outline',
  minus: 'minus-thick',
  'plus.forwardslash.minus': 'plus-minus',
  'person.2': 'account-multiple-outline',
  'sidebar.left': 'page-layout-sidebar-left',
  'sidebar.right': 'page-layout-sidebar-right',
  'list.bullet.indent': 'format-list-bulleted',
  'info.circle': 'information-outline',
  pin: 'pin-outline',
  'pin.fill': 'pin',
  'paperplane.fill': 'send',
  trash: 'trash-can-outline',
  'arrow.right.doc.on.clipboard': 'clipboard-arrow-right-outline',
  'slider.horizontal.3': 'tune',
  bolt: 'lightning-bolt-outline',
  'bolt.fill': 'lightning-bolt',
};

type MdiName = ComponentProps<typeof MaterialDesignIcons>['name'];

type IconProps = {
  name: SFSymbol;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

export function Icon({
  name,
  size = 20,
  color = theme.text,
  style,
}: IconProps) {
  const mdiName = (SF_TO_MDI[name] ?? 'help-circle-outline') as MdiName;
  return (
    <SymbolView
      symbolName={name}
      tintColor={color}
      pointSize={size}
      style={[{ width: size, height: size }, style]}
      fallback={
        <MaterialDesignIcons
          name={mdiName}
          size={size}
          color={color as string}
        />
      }
    />
  );
}
