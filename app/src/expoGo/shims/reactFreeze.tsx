// Expo Go preview shim — not used in production builds.
// react-freeze is not bundled in Expo Go; render children unfrozen (purely
// a render-suspension optimization upstream).

import React, { type ReactNode } from 'react';

export const Freeze = ({
  children,
}: {
  freeze?: boolean;
  children?: ReactNode;
  placeholder?: ReactNode;
}) => <>{children}</>;

export default Freeze;
