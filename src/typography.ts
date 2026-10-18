import { Platform } from 'react-native';

export const HEADING_FONT_FAMILY = Platform.select({
  ios: 'Baskerville',
  android: 'serif',
  web: 'Baskerville, Georgia, serif',
  default: 'serif',
});
