import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { DARK_BROWN, DARK_SAGE, EARTHY_CLAY, SOFT_BLUSH } from '@/colors';

export type ProjectSectionDefinition = {
  id: string;
  title: string;
};

export function ProjectSectionNavigation({
  accessibilityLabel = 'Project sections',
  onSelect,
  sections,
  selectedId,
  testID = 'project-section-navigation',
}: {
  accessibilityLabel?: string;
  onSelect: (section: ProjectSectionDefinition) => void;
  sections: readonly ProjectSectionDefinition[];
  selectedId: string;
  testID?: string;
}) {
  return (
    <ScrollView
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.navigation}
      testID={testID}
    >
      {sections.map((section) => {
        const selected = section.id === selectedId;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={section.id}
            onPress={() => onSelect(section)}
            style={[styles.item, selected && styles.itemSelected]}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>{section.title}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  navigation: { borderBottomColor: SOFT_BLUSH, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flexGrow: 1, paddingHorizontal: 20 },
  item: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    minHeight: 52,
  },
  itemSelected: { borderBottomColor: DARK_SAGE },
  text: { color: EARTHY_CLAY, fontSize: 14, fontWeight: '500' },
  textSelected: { color: DARK_BROWN },
});
