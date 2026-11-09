// Root layout for Auri. This file sets up the app-wide structure,
// including authentication and navigation. It controls what users
// can access when the app starts and applies to all screens.

import 'react-native-url-polyfill/auto';
import { APP_BACKGROUND } from '@/colors';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useVisibleViewport } from '@/features/home/use-visible-viewport';
import AuthLoadingScreen from '@/features/auth/auth-loading-screen';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import SignInScreen from '@/features/auth/sign-in-screen';


// Checks the user's authentication status and decides whether to
// display the loading screen, sign-in screen, or main app navigation.
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


// Sets up the authentication provider and status bar for the entire app.
// Wraps AuthenticatedRouter so it can access the user's authentication status.
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
