import { APP_BACKGROUND, DARK_BROWN, DARK_SAGE, EARTHY_CLAY, LIGHT_SAGE, SOFT_BLUSH, SOFT_WHITE } from '@/colors';
import { HEADING_FONT_FAMILY } from '@/typography';
import { useCallback, useMemo, useState } from 'react';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Project } from '@/domain/projects';
import { projectRepository } from '@/services/projects/project-client';

import {
  projectDescription,
  projectFallbackInitial,
  projectLibraryCollections,
  projectRecencyLabel,
  type ProjectSort,
} from './project-presentation';
import { projectSortPreference } from './project-view-preference';

const SORT_OPTIONS: readonly { label: string; value: ProjectSort }[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'Created', value: 'created' },
  { label: 'Name', value: 'name' },
];

function SortControl({ onChange, value }: { onChange: (value: ProjectSort) => void; value: ProjectSort }) {
  return (
    <View accessibilityLabel="Sort Projects" style={styles.sortControl} testID="projects-sort-control">
      {SORT_OPTIONS.map((option) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value }}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [styles.sortButton, value === option.value && styles.sortButtonSelected, pressed && styles.pressed]}
          testID={`projects-sort-${option.value}`}
        >
          <Text style={[styles.sortText, value === option.value && styles.sortTextSelected]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProjectRow({ archived = false, blush = false, onPress, project }: { archived?: boolean; blush?: boolean; onPress: () => void; project: Project }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={projectRecencyLabel(project.updatedAt)}
      onPress={onPress}
      style={({ pressed }) => [styles.projectRow, pressed && styles.pressed]}
      testID={`project-row-${project.id}`}
    >
      <View style={[styles.fallbackCover, blush && styles.blushCover]} testID="project-cover-fallback">
        <Text style={[styles.fallbackInitial, blush && styles.blushInitial]}>{projectFallbackInitial(project)}</Text>
      </View>
      <View style={styles.projectCopy}>
        <View style={styles.projectHeading}>
          <Text style={styles.projectName}>{project.name}</Text>
          {archived ? <Text style={styles.archiveMarker}>Archived</Text> : null}
        </View>
        <Text numberOfLines={2} style={styles.projectDescription}>{projectDescription(project)}</Text>
      </View>
      <Text accessible={false} style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sort, setSort] = useState<ProjectSort>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([projectRepository.listProjects(), projectSortPreference.load()]).then(
      ([values, savedSort]) => {
        if (!active) return;
        setProjects(values);
        setSort(savedSort);
      },
      () => active && setError('Projects could not be loaded.'),
    ).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []));

  const collections = useMemo(() => projectLibraryCollections(projects, sort), [projects, sort]);
  const changeSort = (value: ProjectSort) => {
    setSort(value);
    void projectSortPreference.save(value).catch(() => undefined);
  };
  const openProject = (project: Project) => router.push({
    pathname: '/projects/[id]', params: { id: project.id },
  } as unknown as Href);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea} testID="projects-screen">
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Projects</Text>
          <Text style={styles.subtitle}>A space for the things you’re working on. I’ll keep everything organized and ready for you.</Text>
        </View>

        {loading ? <View style={styles.center}><ActivityIndicator color={DARK_SAGE} /></View> : error ? (
          <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View>
        ) : projects.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No Projects yet</Text>
            <Text style={styles.emptyBody}>Create a space when something deserves ongoing attention.</Text>
          </View>
        ) : (
          <View testID="projects-library">
            {collections.projects.map((project, index) => <ProjectRow blush={index % 2 === 1} key={project.id} onPress={() => openProject(project)} project={project} />)}
          </View>
        )}

        <Pressable accessibilityRole="button" onPress={() => router.push('/projects/new' as Href)} style={({ pressed }) => [styles.newButton, pressed && styles.pressed]} testID="new-project-button">
          <Text style={styles.newButtonText}>+ New Project</Text>
        </Pressable>
        <View style={styles.controls}>
          <Text style={styles.sortLabel}>Sort by</Text>
          <SortControl onChange={changeSort} value={sort} />
        </View>

        {!loading && !error && collections.archived.length > 0 ? (
          <View style={styles.archiveSection} testID="projects-archive-section">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchived }} onPress={() => setShowArchived((value) => !value)} style={({ pressed }) => [styles.archiveButton, pressed && styles.pressed]} testID="toggle-archived-projects">
              <Text style={styles.archiveButtonText}>Archived ({collections.archived.length})</Text>
              <Text style={styles.archiveChevron}>{showArchived ? '⌃' : '⌄'}</Text>
            </Pressable>
            {showArchived ? collections.archived.map((project, index) => <ProjectRow archived blush={index % 2 === 1} key={project.id} onPress={() => openProject(project)} project={project} />) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: APP_BACKGROUND, flex: 1 },
  header: { alignItems: 'center', paddingBottom: 71 },
  title: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 28, fontWeight: '400', lineHeight: 36, textAlign: 'center' },
  subtitle: { color: `${DARK_BROWN}80`, fontSize: 14, lineHeight: 20, marginTop: 20, maxWidth: 250, textAlign: 'center' },
  newButton: { alignItems: 'center', alignSelf: 'center', backgroundColor: `${SOFT_BLUSH}80`, borderRadius: 24, justifyContent: 'center', marginTop: 16, minHeight: 44, paddingHorizontal: 20 },
  newButtonText: { color: DARK_BROWN, fontSize: 14, fontWeight: '500' },
  controls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 28 },
  sortLabel: { color: EARTHY_CLAY, fontSize: 12 },
  sortControl: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  sortButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 11 },
  sortButtonSelected: { backgroundColor: SOFT_BLUSH },
  sortText: { color: EARTHY_CLAY, fontSize: 12, fontWeight: '500' },
  sortTextSelected: { color: DARK_BROWN },
  content: { alignSelf: 'center', flexGrow: 1, maxWidth: 720, paddingBottom: 32, paddingHorizontal: 32, paddingTop: 48, width: '100%' },
  projectRow: {
    alignItems: 'flex-start',
    backgroundColor: SOFT_WHITE,
    borderColor: SOFT_WHITE,
    borderRadius: 24,
    borderWidth: 1,
    boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 20, color: `${EARTHY_CLAY}14` }],
    flexDirection: 'row',
    marginBottom: 20,
    minHeight: 134,
    paddingHorizontal: 20,
    paddingVertical: 26,
  },
  fallbackCover: { alignItems: 'center', backgroundColor: `${LIGHT_SAGE}26`, borderRadius: 23, height: 46, justifyContent: 'center', width: 46 },
  blushCover: { backgroundColor: SOFT_BLUSH },
  fallbackInitial: { color: DARK_SAGE, fontFamily: HEADING_FONT_FAMILY, fontSize: 23 },
  blushInitial: { color: EARTHY_CLAY },
  projectCopy: { flex: 1, marginLeft: 18, minWidth: 0 },
  projectHeading: { alignItems: 'center', flexDirection: 'row', minWidth: 0 },
  projectName: { color: DARK_BROWN, flexShrink: 1, fontFamily: HEADING_FONT_FAMILY, fontSize: 19, fontWeight: '400', lineHeight: 25 },
  projectDescription: { color: `${DARK_BROWN}80`, fontSize: 13, lineHeight: 19, marginTop: 8 },
  chevron: { alignSelf: 'center', color: `${DARK_BROWN}80`, fontSize: 27, fontWeight: '300', marginLeft: 10 },
  archiveMarker: { color: EARTHY_CLAY, fontSize: 10, marginLeft: 8 },
  archiveSection: { marginTop: 20 },
  archiveButton: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
  archiveButtonText: { color: EARTHY_CLAY, fontSize: 12, fontWeight: '600' },
  archiveChevron: { color: EARTHY_CLAY, fontSize: 17 },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 134, paddingVertical: 24 },
  error: { color: EARTHY_CLAY, fontSize: 14, textAlign: 'center' },
  emptyTitle: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 22 },
  emptyBody: { color: EARTHY_CLAY, fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: 300, textAlign: 'center' },
  pressed: { opacity: 0.58 },
});
