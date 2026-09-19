// Expo Go preview shim — not used in production builds.
// zeego (dropdown-menu / context-menu) needs @react-native-menu/menu, which
// is NOT bundled in Expo Go. This ActionSheetIOS-based fallback implements
// the subset the app uses: Root, Trigger, Content, Item, ItemTitle,
// ItemIcon, Group, Separator, Label. Dropdown Trigger opens on press;
// ContextMenu Trigger opens on long-press.

import React, {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text } from 'react-native';

interface ItemDef {
  title: string;
  destructive?: boolean;
  onSelect?: () => void;
}

interface MenuCtx {
  open(): void;
}

const Ctx = createContext<MenuCtx>({ open: () => {} });

const flatten = (children: ReactNode): React.ReactElement[] => {
  const out: React.ReactElement[] = [];
  React.Children.forEach(children, c => {
    if (React.isValidElement(c)) out.push(c);
  });
  return out;
};

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (React.isValidElement(node))
    return textOf(
      (node.props as { children?: ReactNode } | undefined)?.children,
    );
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
};

const displayNameOf = (el: React.ReactElement): string | undefined =>
  (el.type as { displayName?: string }).displayName;

/** Find <Content> even when a helper wraps it (recurse unknown nodes). */
const findContent = (nodes: ReactNode): React.ReactElement | undefined => {
  for (const el of flatten(nodes)) {
    if (displayNameOf(el) === 'GoMenuContent') return el;
    const nested = (el.props as { children?: ReactNode }).children;
    const found = findContent(nested);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** Pull {title, onSelect, destructive} out of <Content><Item><ItemTitle>…
 * trees (Groups are flattened; Label becomes a disabled header row). */
const collectItems = (children: ReactNode): ItemDef[] => {
  const content = findContent(children);
  if (content === undefined) return [];
  const contentProps = content.props as { children?: ReactNode };
  const walk = (nodes: ReactNode): ItemDef[] => {
    const out: ItemDef[] = [];
    for (const el of flatten(nodes)) {
      const name = displayNameOf(el);
      const props = el.props as Record<string, unknown> & {
        children?: ReactNode;
      };
      if (name === 'GoMenuItem') {
        const titleEl = flatten(props.children).find(
          c => displayNameOf(c) === 'GoMenuItemTitle',
        );
        out.push({
          title: textOf(
            (titleEl?.props as { children?: ReactNode } | undefined)?.children,
          ),
          destructive: props.destructive === true,
          onSelect: props.onSelect as (() => void) | undefined,
        });
      } else {
        out.push(...walk(props.children));
      }
    }
    return out;
  };
  return walk(contentProps.children);
};

const present = (items: ItemDef[]): void => {
  const labels = items.map(i => i.title);
  if (Platform.OS === 'ios') {
    const destructive = items.findIndex(i => i.destructive === true);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      i => {
        if (i < items.length) items[i].onSelect?.();
      },
    );
  } else {
    Alert.alert('', undefined, [
      ...items.map(i => ({
        text: i.title,
        style: (i.destructive ? 'destructive' : 'default') as
          | 'destructive'
          | 'default',
        onPress: () => i.onSelect?.(),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
};

export const makeMenu = ({ longPress }: { longPress: boolean }) => {
  const Root = ({
    children,
    onOpenChange,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    const open = useCallback(() => {
      onOpenChange?.(true);
      present(collectItems(children));
      onOpenChange?.(false);
    }, [children, onOpenChange]);
    return <Ctx.Provider value={{ open }}>{children}</Ctx.Provider>;
  };

  const Trigger = ({
    children,
    asChild,
  }: {
    children?: ReactNode;
    asChild?: boolean;
  }) => {
    const { open } = useContext(Ctx);
    const menuPress = longPress ? undefined : open;
    const menuLongPress = longPress ? open : undefined;
    const child =
      React.Children.count(children) === 1
        ? React.Children.only(children)
        : undefined;
    const childEl = React.isValidElement(child) ? child : undefined;
    const childPress =
      childEl !== undefined
        ? (childEl.props as {
            onPress?: (event: unknown) => void;
            onLongPress?: (event: unknown) => void;
          })
        : undefined;
    const shouldClone =
      childEl !== undefined &&
      (asChild === true ||
        childPress?.onPress !== undefined ||
        childPress?.onLongPress !== undefined);
    if (shouldClone && childEl !== undefined) {
      return React.cloneElement(
        childEl as React.ReactElement<{
          onPress?: (event: unknown) => void;
          onLongPress?: (event: unknown) => void;
        }>,
        {
          onPress: longPress
            ? childPress?.onPress
            : (event: unknown) => {
                childPress?.onPress?.(event);
                open();
              },
          onLongPress: longPress
            ? (event: unknown) => {
                childPress?.onLongPress?.(event);
                open();
              }
            : childPress?.onLongPress,
        },
      );
    }
    return (
      <Pressable onPress={menuPress} onLongPress={menuLongPress}>
        {children}
      </Pressable>
    );
  };

  // Never rendered visibly — the sheet is built by traversal at open time.
  const Content = () => null;
  Content.displayName = 'GoMenuContent';

  const Item = ({ children }: { children?: ReactNode }) => <>{children}</>;
  Item.displayName = 'GoMenuItem';

  const ItemTitle = ({ children }: { children?: ReactNode }) => (
    <Text>{children}</Text>
  );
  ItemTitle.displayName = 'GoMenuItemTitle';

  const ItemIcon = () => null;
  ItemIcon.displayName = 'GoMenuItemIcon';
  const ItemSubtitle = () => null;
  ItemSubtitle.displayName = 'GoMenuItemSubtitle';
  const Group = ({ children }: { children?: ReactNode }) => <>{children}</>;
  Group.displayName = 'GoMenuGroup';
  const Separator = () => null;
  Separator.displayName = 'GoMenuSeparator';
  const Label = ({ children }: { children?: ReactNode }) => (
    <Text>{children}</Text>
  );
  Label.displayName = 'GoMenuLabel';

  return {
    Root,
    Trigger,
    Content,
    Item,
    ItemTitle,
    ItemIcon,
    ItemSubtitle,
    Group,
    Separator,
    Label,
  };
};
