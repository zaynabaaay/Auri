import { APP_BACKGROUND } from '@/colors';
import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
          name="viewport"
        />
        <ScrollViewStyleReset />
      </head>
      <body style={{ backgroundColor: APP_BACKGROUND }}>{children}</body>
    </html>
  );
}
