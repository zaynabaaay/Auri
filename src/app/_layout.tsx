import 'react-native-url-polyfill/auto';

import { APP_BACKGROUND } from '@/colors';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { useVisibleViewport } from '@/features/home/use-visible-viewport';

import AuthLoadingScreen from '@/features/auth/auth-loading-screen';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import SignInScreen from '@/features/auth/sign-in-screen';

function AuthenticatedRouter() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <AuthLoadingScreen />;
  }

  if (status !== 'authenticated') {
    return <SignInScreen />;
  }

  return (
    <Stack
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: APP_BACKGROUND },
        headerShown: false,
      }}
    />
  );
}

export default function RootLayout() {
  const visibleViewport = useVisibleViewport();

  return (
    <AuthProvider>
      <View
        style={[
          styles.container,
          visibleViewport && styles.viewportWeb,
          visibleViewport && {
            height: visibleViewport.height,
            top: visibleViewport.top,
          },
        ]}
      >
        <StatusBar style="dark" />
        <AuthenticatedRouter />
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: APP_BACKGROUND, flex: 1 },
  viewportWeb: {
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
  },
});
