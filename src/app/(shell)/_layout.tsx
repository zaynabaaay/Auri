import { APP_BACKGROUND, DARK_BROWN, DARK_SAGE, SOFT_BLUSH } from '@/colors';
import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

function TinaIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[styles.tinaIcon, !focused && styles.inactive]}>
      <View style={[styles.tinaBubble, focused && styles.iconFocused]} />
      <View style={[styles.tinaTail, focused && styles.tailFocused]} />
    </View>
  );
}

function ProjectsIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[styles.projectsIcon, focused && styles.projectsIconFocused, !focused && styles.inactive]}>
      <View style={[styles.projectLine, focused && styles.lineFocused]} />
      <View style={[styles.projectLine, styles.projectLineShort, focused && styles.lineFocused]} />
    </View>
  );
}

function TasksIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[styles.tasksIcon, !focused && styles.inactive]}>
      <View style={[styles.taskCheck, styles.taskCheckShort, focused && styles.lineFocused]} />
      <View style={[styles.taskCheck, styles.taskCheckLong, focused && styles.lineFocused]} />
    </View>
  );
}

export default function ShellLayout() {
  return (
    <Tabs
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
        name="index"
        options={{
          tabBarAccessibilityLabel: 'Auri conversation',
          tabBarIcon: ({ focused }) => <TinaIcon focused={focused} />,
          tabBarLabel: ({ focused }) => <Text style={[styles.label, focused ? styles.labelFocused : styles.inactive]}>Auri</Text>,
          title: 'Auri',
        }}
      />
      <Tabs.Screen
        name="projects/index"
        options={{
          tabBarAccessibilityLabel: 'Projects library',
          tabBarIcon: ({ focused }) => <ProjectsIcon focused={focused} />,
          tabBarLabel: ({ focused }) => <Text style={[styles.label, focused ? styles.labelFocused : styles.inactive]}>Projects</Text>,
          title: 'Projects',
        }}
      />
      <Tabs.Screen
        name="tasks/index"
        options={{
          tabBarAccessibilityLabel: 'Tasks',
          tabBarIcon: ({ focused }) => <TasksIcon focused={focused} />,
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
  tinaIcon: { height: 21, position: 'relative', width: 22 },
  tinaBubble: {
    borderColor: DARK_BROWN, borderRadius: 7, borderWidth: 1.5, height: 16, width: 21,
  },
  tinaTail: {
    borderBottomColor: DARK_BROWN, borderBottomWidth: 1.5, height: 6,
    left: 4, position: 'absolute', top: 13, transform: [{ rotate: '-35deg' }], width: 6,
  },
  iconFocused: { borderColor: DARK_SAGE },
  tailFocused: { borderBottomColor: DARK_SAGE },
  projectsIcon: {
    borderColor: DARK_BROWN, borderRadius: 4, borderWidth: 1.5,
    height: 19, justifyContent: 'center', paddingHorizontal: 4, width: 21,
  },
  projectsIconFocused: { borderColor: DARK_SAGE },
  projectLine: { backgroundColor: DARK_BROWN, borderRadius: 1, height: 1.5, width: 11 },
  lineFocused: { backgroundColor: DARK_SAGE },
  projectLineShort: { marginTop: 4, width: 7 },
  tasksIcon: { height: 21, position: 'relative', width: 22 },
  taskCheck: { backgroundColor: DARK_BROWN, borderRadius: 1, height: 1.5, position: 'absolute' },
  taskCheckShort: { left: 2, top: 12, transform: [{ rotate: '45deg' }], width: 7 },
  taskCheckLong: { left: 6, top: 9, transform: [{ rotate: '-45deg' }], width: 14 },
});
