import { APP_BACKGROUND, DARK_BROWN, DARK_SAGE, SOFT_BLUSH } from '@/colors';
import { useFonts } from 'expo-font';
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

export default function ShellLayout() {
  const [iconsLoaded] = useFonts({
    AuriFooterIcons: require('@expo-google-fonts/material-symbols/300Light/MaterialSymbols_300Light.ttf'),
  });

  return (
    <Tabs
      initialRouteName="index"
      backBehavior="history"
      detachInactiveScreens={false}
      screenOptions={{
        animation: 'fade',
        headerShown: false,
        lazy: false,
        sceneStyle: styles.scene,
        tabBarActiveTintColor: DARK_SAGE,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: DARK_BROWN,
        tabBarItemStyle: styles.tabBarItem,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
      }}
    >
      <Tabs.Screen
        name="projects/index"
        options={{
          tabBarAccessibilityLabel: 'Projects library',
          tabBarIcon: ({ focused, color }) => (
            <Text
              accessible={false}
              allowFontScaling={false}
              style={[styles.footerIcon, { color }, !focused && styles.inactive]}
            >
              {iconsLoaded ? '\ue2c7' : null}
            </Text>
          ),
          tabBarLabel: ({ focused }) => <Text style={[styles.label, focused ? styles.labelFocused : styles.inactive]}>Projects</Text>,
          title: 'Projects',
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          tabBarAccessibilityLabel: 'Auri conversation',
          tabBarIcon: ({ focused, color }) => (
            <Text
              accessible={false}
              allowFontScaling={false}
              style={[styles.footerIcon, { color }, !focused && styles.inactive]}
            >
              {iconsLoaded ? '\ue0cb' : null}
            </Text>
          ),
          tabBarLabel: ({ focused }) => <Text style={[styles.label, focused ? styles.labelFocused : styles.inactive]}>Auri</Text>,
          title: 'Auri',
        }}
      />
      <Tabs.Screen
        name="tasks/index"
        options={{
          tabBarAccessibilityLabel: 'Tasks',
          tabBarIcon: ({ focused, color }) => (
            <Text
              accessible={false}
              allowFontScaling={false}
              style={[styles.footerIcon, { color }, !focused && styles.inactive]}
            >
              {iconsLoaded ? '\ue6b1' : null}
            </Text>
          ),
          tabBarLabel: ({ focused }) => <Text style={[styles.label, focused ? styles.labelFocused : styles.inactive]}>Tasks</Text>,
          title: 'Tasks',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: APP_BACKGROUND },
  tabBar: {
    backgroundColor: APP_BACKGROUND,
    borderTopColor: SOFT_BLUSH,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
  },
  tabBarItem: { minHeight: 48, paddingTop: 4 },
  label: { color: DARK_BROWN, fontSize: 11, fontWeight: '500', letterSpacing: 0.1 },
  labelFocused: { fontWeight: '600' },
  inactive: { opacity: 0.7 },
  footerIcon: {
    fontFamily: 'AuriFooterIcons',
    fontSize: 24,
    height: 24,
    includeFontPadding: false,
    lineHeight: 24,
    textAlign: 'center',
    width: 24,
  },
});
