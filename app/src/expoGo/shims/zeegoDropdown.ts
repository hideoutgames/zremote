// Expo Go preview shim — not used in production builds.
import { makeMenu } from './zeegoMenu';

export const {
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
} = makeMenu({ longPress: false });
