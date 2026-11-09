import { APP_BACKGROUND, ASSISTANT_MESSAGE_BACKGROUND, DARK_BROWN, DARK_SAGE, EARTHY_CLAY, LIGHT_SAGE, MESSAGE_TEXT_COLOR, SOFT_BLUSH, SOFT_WHITE, USER_MESSAGE_BACKGROUND } from '@/colors';
import { HEADING_FONT_FAMILY } from '@/typography';
import { useEffect, useRef, useState } from 'react';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Project, ProjectKnowledgeItem, ProjectSection, ProjectTask, ProjectWorkSession, ProjectWorkSessionEntry } from '@/domain/projects';
import { useReducedMotion } from '@/features/accessibility/use-reduced-motion';
import { MessageComposer } from '@/features/home/message-composer';
import {
  MESSAGE_INPUT_MIN_HEIGHT,
  messageInputHeight,
  messageSendEnabled,
} from '@/features/home/message-composer-layout';
import { assistantService } from '@/services/assistant/assistant-service';
import { projectChatService, projectRepository, projectService } from '@/services/projects/project-client';

import { ProjectSectionAssets } from './project-section-assets';
import { ProjectSectionNavigation } from './project-section-navigation';
import { ProjectSectionsManager } from './project-sections-manager';
import { projectFallbackInitial, projectTaskDueLabel, projectTaskStatusLabel, upcomingProjectTasks } from './project-presentation';

const KEYBOARD_AVOIDING_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;

const PROJECT_VIEWS = [
  { id: 'overview', title: 'Overview' },
  { id: 'tasks', title: 'Tasks' },
  { id: 'notes', title: 'Notes' },
  { id: 'files', title: 'Files' },
];

function ProjectTaskCard({ task }: { task: ProjectTask }) {
  const due = projectTaskDueLabel(task);
  return (
    <View style={styles.taskCard} testID={`project-task-${task.id}`}>
      <View style={styles.taskCopy}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        {due ? <Text style={styles.taskDue}>{due}</Text> : null}
      </View>
      <View style={styles.taskStatus}><Text style={styles.taskStatusText}>{projectTaskStatusLabel(task.status)}</Text></View>
    </View>
  );
}

function ThinkingIndicator() {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reducedMotion) { progress.setValue(0.5); return; }
    const animation = Animated.loop(Animated.timing(progress, { duration: 1050, toValue: 1, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return (
    <View accessibilityLabel="Auri is thinking" style={styles.thinking} testID="project-thinking-indicator">
      {[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.dot, { opacity: reducedMotion ? 0.55 : progress.interpolate({ inputRange: [0, 0.08 + index * 0.18, 0.38 + index * 0.18, 1], outputRange: [0.25, 0.25, 0.9, 0.25] }) }]} />)}
    </View>
  );
}

function Transcript({ entries, responding }: { entries: ProjectWorkSessionEntry[]; responding: boolean }) {
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      contentContainerStyle={styles.transcriptContent}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      ref={scroll}
      showsVerticalScrollIndicator={false}
      style={styles.transcript}
      testID="project-conversation-scroll"
    >
      {entries.length === 0 && !responding ? <Text style={styles.tinaEmpty}>Ask about anything in this Project.</Text> : null}
      {entries.map((entry) => {
        const user = entry.kind === 'user_message';
        return <View key={entry.id} style={user ? styles.userMessage : styles.assistantMessage}><Text style={user ? styles.userText : styles.assistantText}>{entry.content}</Text></View>;
      })}
      {responding ? <ThinkingIndicator /> : null}
    </ScrollView>
  );
}

function ProjectActions({ onClose, onManageSections, onOpenOverviewFiles, onUpdated, project, visible }: {
  onClose: () => void;
  onManageSections: () => void;
  onOpenOverviewFiles: () => void;
  onUpdated: (project: Project) => void;
  project: Project;
  visible: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const update = async (input: Parameters<typeof projectService.updateProject>[1]) => {
    setSaving(true);
    try {
      const result = await projectService.updateProject(project.id, input);
      onUpdated(result.value);
      setEditing(false);
      onClose();
    } finally { setSaving(false); }
  };
  const archive = () => Alert.alert('Archive this Project?', 'It will remain available in the Archived collection.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: () => void update({ status: 'archived' }) },
  ]);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.actionSheet}>
          {editing ? <>
            <Text style={styles.sheetTitle}>Edit Project</Text>
            <TextInput keyboardAppearance="light" maxLength={300} onChangeText={setName} style={styles.sheetInput} value={name} />
            <TextInput keyboardAppearance="light" maxLength={600} multiline onChangeText={setDescription} placeholder="Short description" placeholderTextColor={EARTHY_CLAY} style={[styles.sheetInput, styles.sheetDescription]} value={description} />
            <Pressable disabled={saving || !name.trim()} onPress={() => update({ ...(description.trim() ? { description: description.trim() } : {}), name: name.trim() })} style={styles.primaryAction}><Text style={styles.primaryActionText}>{saving ? 'Saving…' : 'Save changes'}</Text></Pressable>
          </> : <>
            <Pressable onPress={() => setEditing(true)} style={styles.actionRow}><Text style={styles.actionText}>Edit Project</Text></Pressable>
            <Pressable onPress={() => { onClose(); onManageSections(); }} style={styles.actionRow} testID="manage-project-sections"><Text style={styles.actionText}>Manage sections</Text></Pressable>
            <Pressable onPress={() => { onClose(); onOpenOverviewFiles(); }} style={styles.actionRow} testID="open-project-overview-files"><Text style={styles.actionText}>Overview files</Text></Pressable>
            {project.status === 'active' ? <Pressable onPress={() => void update({ status: 'paused' })} style={styles.actionRow}><Text style={styles.actionText}>Pause</Text></Pressable> : null}
            {project.status === 'paused' ? <Pressable onPress={() => void update({ status: 'active' })} style={styles.actionRow}><Text style={styles.actionText}>Resume</Text></Pressable> : null}
            {project.status !== 'archived' ? <Pressable onPress={archive} style={styles.actionRow}><Text style={styles.destructiveText}>Archive</Text></Pressable> : null}
          </>}
          <Pressable onPress={onClose} style={[styles.actionRow, styles.cancelRow]}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OverviewFiles({ onClose, onError, projectId, section, sections }: {
  onClose: () => void;
  onError: (message: string | null) => void;
  projectId: string;
  section: ProjectSection;
  sections: readonly ProjectSection[];
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible>
      <SafeAreaView style={styles.filesAccess} testID="project-overview-files-access">
        <View style={styles.filesAccessHeader}>
          <View>
            <Text style={styles.filesAccessTitle}>Overview files</Text>
            <Text style={styles.filesAccessNote}>Files already saved to this section</Text>
          </View>
          <Pressable accessibilityLabel="Close Overview files" onPress={onClose} style={styles.filesAccessClose}><Text style={styles.filesAccessCloseText}>Done</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.filesAccessContent} showsVerticalScrollIndicator={false}>
          <ProjectSectionAssets onError={onError} projectId={projectId} section={section} sections={sections} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [sections, setSections] = useState<ProjectSection[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [notes, setNotes] = useState<ProjectKnowledgeItem[]>([]);
  const [selectedView, setSelectedView] = useState('overview');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [session, setSession] = useState<ProjectWorkSession | null>(null);
  const [entries, setEntries] = useState<ProjectWorkSessionEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(MESSAGE_INPUT_MIN_HEIGHT);
  const [listening, setListening] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [saving, setSaving] = useState(false);
  const [responding, setResponding] = useState(false);
  const [startingNewChat, setStartingNewChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [overviewFilesOpen, setOverviewFilesOpen] = useState(false);
  const [tinaOpen, setTinaOpen] = useState(false);
  const requestId = useRef(0);
  const canSend = messageSendEnabled(draft, { isFinishing: startingNewChat, isResponding: responding, isRestoring: restoring, isSavingMessage: saving });
  const canStartNewChat = Boolean(session) && !responding && !saving && !restoring && !startingNewChat;

  useEffect(() => {
    let active = true;
    requestId.current += 1;
    assistantService.resetSession();
    Promise.resolve().then(() => {
      if (!active) throw new Error('cancelled');
      setRestoring(true);
      setError(null);
      setDraft('');
      setTinaOpen(false);
      setSelectedView('overview');
      return Promise.all([
        projectRepository.getProject(id),
        projectChatService.load(id),
        projectService.listSections(id),
        projectRepository.listTasks(id),
        projectRepository.listKnowledgeItems(id),
      ]);
    }).then(
      ([value, chat, persistedSections, projectTasks, knowledge]) => {
        if (!active) return;
        if (!value) { setError('Project was not found.'); return; }
        setProject(value);
        setSession(chat.session);
        setEntries(chat.entries.filter((entry) => entry.kind === 'user_message' || entry.kind === 'assistant_message'));
        setSections(persistedSections);
        setTasks(projectTasks);
        setNotes(knowledge.filter((item) => item.kind === 'note' && item.status === 'current'));
        setSelectedSectionId(
          persistedSections.find((section) => section.isDefault)?.id ??
          persistedSections.find((section) => section.status === 'active')?.id ?? null,
        );
      },
      () => active && setError('The Project could not be loaded.'),
    ).finally(() => active && setRestoring(false));
    return () => { active = false; requestId.current += 1; assistantService.cancelRequest(); };
  }, [id]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !session || !project || !canSend) return;
    setSaving(true);
    setError(null);
    let userEntry: ProjectWorkSessionEntry;
    try {
      userEntry = await projectChatService.append(session, 'user_message', content, entries.length);
      setEntries((current) => [...current, userEntry]);
      setDraft('');
      setInputHeight(MESSAGE_INPUT_MIN_HEIGHT);
      setListening(false);
    } catch {
      setError('Message was not saved. Your draft is still here.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setResponding(true);
    const currentRequest = ++requestId.current;
    const transcript = [...entries, userEntry].slice(-50).map((entry) => ({ content: entry.content, role: entry.kind === 'user_message' ? 'user' as const : 'assistant' as const }));
    const result = await assistantService.respond(transcript, {
      projectId: project.id,
      projectName: project.name,
    });
    if (requestId.current !== currentRequest) return;
    if (result.status === 'success') {
      try {
        const assistantEntry = await projectChatService.append(session, 'assistant_message', result.message.content, entries.length + 1);
        setEntries((current) => [...current, assistantEntry]);
      } catch { setError('Auri replied, but the reply could not be saved.'); }
    } else if (result.status === 'error') setError(result.error.message);
    setResponding(false);
  };

  const startNewChat = async () => {
    if (!session || !project || !canStartNewChat) return;
    Keyboard.dismiss();
    setStartingNewChat(true);
    setError(null);
    assistantService.cancelRequest();
    const currentRequest = ++requestId.current;
    try {
      const freshSession = await projectChatService.startNewSession(session);
      if (requestId.current !== currentRequest) return;
      assistantService.resetSession();
      setSession(freshSession);
      setEntries([]);
      setDraft('');
      setInputHeight(MESSAGE_INPUT_MIN_HEIGHT);
      setListening(false);
    } catch {
      if (requestId.current === currentRequest) {
        setError('A new Project chat could not be started. Nothing was cleared.');
      }
    } finally {
      if (requestId.current === currentRequest) setStartingNewChat(false);
    }
  };

  const activeSections = sections.filter((section) => section.status === 'active');
  const selectedSection = activeSections.find(
    (section) => section.id === selectedSectionId,
  ) ?? activeSections.find((section) => section.isDefault) ?? null;
  const overviewSection = activeSections.find((section) => section.isDefault);
  const overviewAnchor = project?.goal?.trim();
  const upcoming = upcomingProjectTasks(tasks);

  const sectionsChanged = (nextSections: ProjectSection[]) => {
    setSections(nextSections);
    if (!nextSections.some(
      (section) => section.id === selectedSectionId && section.status === 'active',
    )) {
      setSelectedSectionId(
        nextSections.find((section) => section.isDefault)?.id ?? null,
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} testID="project-screen">
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING_BEHAVIOR} keyboardVerticalOffset={0} style={styles.keyboardView} testID="project-keyboard-layout">
        <View style={styles.workspace}>
          <ScrollView contentContainerStyle={[styles.workspaceContent, tinaOpen && styles.workspaceContentWithTina]} showsVerticalScrollIndicator={false} testID="project-home-scroll">
            <View style={styles.topBar}>
              <Pressable accessibilityLabel="Back to Projects" onPress={() => router.replace('/projects' as Href)} style={styles.headerButton}><Text style={styles.back}>‹</Text></Pressable>
              <Pressable accessibilityLabel="Project actions" disabled={!project} onPress={() => setActionsOpen(true)} style={styles.headerButton} testID="project-actions-button"><Text style={styles.more}>•••</Text></Pressable>
            </View>

            {restoring ? <Text style={styles.notice}>Opening Project…</Text> : project ? <>
              <View style={styles.identity} testID="project-identity">
                <View style={styles.coverFallback} testID="project-home-cover-fallback">
                  <Text style={styles.coverInitial}>{projectFallbackInitial(project)}</Text>
                </View>
                <View style={styles.identityCopy}>
                  <Text style={styles.projectName}>{project.name}</Text>
                  {project.description ? <Text style={styles.projectDescription}>{project.description}</Text> : null}
                </View>
              </View>

              <ProjectSectionNavigation accessibilityLabel="Project views" onSelect={(view) => setSelectedView(view.id)} sections={PROJECT_VIEWS} selectedId={selectedView} testID="project-view-navigation" />
              {selectedView === 'overview' ? (
                <View accessibilityLabel="Project Overview" style={styles.overview} testID="project-overview-section">
                  <View style={styles.overviewContent}>
                    {overviewAnchor ? (
                      <>
                        <Text style={styles.overviewLabel}>Current focus</Text>
                        <Text style={styles.overviewText}>{overviewAnchor}</Text>
                      </>
                    ) : null}
                    <View style={styles.sectionHeading}>
                      <Text accessibilityRole="header" style={styles.sectionTitle}>Upcoming</Text>
                      <Pressable accessibilityRole="button" onPress={() => setSelectedView('tasks')} style={styles.viewAll}><Text style={styles.viewAllText}>View all ›</Text></Pressable>
                    </View>
                    {upcoming.length ? upcoming.map((task) => <ProjectTaskCard key={task.id} task={task} />) : <Text style={styles.overviewEmpty}>No upcoming tasks.</Text>}
                  </View>
                </View>
              ) : selectedView === 'tasks' ? (
                <View accessibilityLabel="Project Tasks" style={styles.sectionContent} testID="project-tasks-section">
                  <Text accessibilityRole="header" style={styles.sectionTitle}>Tasks</Text>
                  {tasks.length ? tasks.map((task) => <ProjectTaskCard key={task.id} task={task} />) : <Text style={styles.overviewEmpty}>No tasks yet.</Text>}
                </View>
              ) : selectedView === 'notes' ? (
                <View accessibilityLabel="Project Notes" style={styles.sectionContent} testID="project-notes-section">
                  <Text accessibilityRole="header" style={styles.sectionTitle}>Notes</Text>
                  {notes.length ? notes.map((note) => <View key={note.id} style={styles.noteCard}>{note.title ? <Text style={styles.taskTitle}>{note.title}</Text> : null}<Text style={styles.noteText}>{note.content}</Text></View>) : <Text style={styles.overviewEmpty}>No notes yet.</Text>}
                </View>
              ) : selectedView === 'files' && selectedSection ? (
                <View accessibilityLabel={`${selectedSection.title} section`} style={styles.customSectionSurface} testID="project-custom-section-surface">
                  {activeSections.length > 1 ? <ProjectSectionNavigation onSelect={(section) => setSelectedSectionId(section.id)} sections={activeSections} selectedId={selectedSection.id} /> : null}
                  <ProjectSectionAssets key={selectedSection.id} onError={setError} projectId={project.id} section={selectedSection} sections={activeSections} title={activeSections.length === 1 ? 'Files' : selectedSection.title} />
                </View>
              ) : null}
            </> : null}
          </ScrollView>

          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
          <View style={[styles.tinaPanel, tinaOpen ? styles.tinaPanelOpen : styles.tinaPanelClosed]} testID="project-tina-control">
            {tinaOpen ? <>
              <View style={styles.tinaHeader}>
                <View><Text style={styles.tinaTitle}>Auri</Text><Text style={styles.tinaScope}>Working in {project?.name ?? 'this Project'}</Text></View>
                <View style={styles.tinaHeaderActions}>
                  <Pressable accessibilityLabel="Start a new Project chat" accessibilityRole="button" disabled={!canStartNewChat} onPress={startNewChat} style={({ pressed }) => [styles.projectNewChatButton, pressed && canStartNewChat && styles.pressed]} testID="project-new-chat-button">
                    <Text style={[styles.projectNewChatText, !canStartNewChat && styles.projectNewChatTextDisabled]}>{startingNewChat ? 'Starting…' : 'New Chat'}</Text>
                  </Pressable>
                  <Pressable accessibilityLabel="Minimize Auri" onPress={() => { Keyboard.dismiss(); setTinaOpen(false); }} style={styles.minimizeButton}><Text style={styles.minimizeText}>⌄</Text></Pressable>
                </View>
              </View>
              <Transcript entries={entries} responding={responding} />
              <MessageComposer canSend={canSend} draft={draft} inputHeight={inputHeight} isBusy={saving || responding} isListening={listening} onChangeText={setDraft} onInputHeightChange={(height) => setInputHeight(messageInputHeight(height))} onSend={send} onToggleListening={() => { Keyboard.dismiss(); setListening((value) => !value); }} />
            </> : (
              <Pressable accessibilityRole="button" onPress={() => setTinaOpen(true)} style={({ pressed }) => [styles.askTina, pressed && styles.pressed]} testID="open-project-tina">
                <View style={styles.tinaMark}><Text style={styles.tinaMarkText}>✦</Text></View>
                <View style={styles.askCopy}><Text style={styles.askTitle}>Ask Auri</Text></View>
              </Pressable>
            )}
          </View>
        </View>
        {project ? <>
          <ProjectActions key={`${project.id}:${project.updatedAt}`} onClose={() => setActionsOpen(false)} onManageSections={() => setSectionsOpen(true)} onOpenOverviewFiles={() => setOverviewFilesOpen(true)} onUpdated={setProject} project={project} visible={actionsOpen} />
          <ProjectSectionsManager onChanged={sectionsChanged} onClose={() => setSectionsOpen(false)} projectId={project.id} sections={sections} visible={sectionsOpen} />
          {overviewFilesOpen && overviewSection ? <OverviewFiles onClose={() => setOverviewFilesOpen(false)} onError={setError} projectId={project.id} section={overviewSection} sections={activeSections} /> : null}
        </> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: APP_BACKGROUND, flex: 1 },
  keyboardView: { flex: 1, position: 'relative' },
  workspace: { alignSelf: 'center', flex: 1, maxWidth: 760, position: 'relative', width: '100%' },
  workspaceContent: { paddingBottom: 102 },
  workspaceContentWithTina: { paddingBottom: 460 },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 20 },
  headerButton: { alignItems: 'center', backgroundColor: `${SOFT_BLUSH}80`, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  back: { color: DARK_BROWN, fontSize: 35, fontWeight: '200', lineHeight: 37 },
  more: { color: DARK_BROWN, fontSize: 16, letterSpacing: 1 },
  identity: { alignItems: 'center', paddingBottom: 28, paddingTop: 12 },
  coverFallback: { alignItems: 'center', backgroundColor: `${LIGHT_SAGE}26`, borderRadius: 32, height: 64, justifyContent: 'center', width: 64 },
  coverInitial: { color: DARK_SAGE, fontFamily: HEADING_FONT_FAMILY, fontSize: 32 },
  identityCopy: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 16 },
  projectName: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 30, fontWeight: '400', lineHeight: 38, textAlign: 'center' },
  projectDescription: { color: `${DARK_BROWN}99`, fontSize: 15, lineHeight: 23, marginTop: 10, maxWidth: 460, textAlign: 'center' },
  overview: { alignItems: 'center', minHeight: 220, paddingBottom: 36, paddingHorizontal: 20, paddingTop: 24 },
  overviewContent: { maxWidth: 640, width: '100%' },
  overviewLabel: { color: EARTHY_CLAY, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  overviewText: { color: DARK_BROWN, fontSize: 16, lineHeight: 24, marginTop: 10, maxWidth: 560 },
  overviewEmpty: { color: EARTHY_CLAY, fontSize: 14, lineHeight: 21, maxWidth: 360 },
  sectionContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 36 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 24, lineHeight: 32 },
  viewAll: { justifyContent: 'center', minHeight: 44, paddingLeft: 12 },
  viewAllText: { color: EARTHY_CLAY, fontSize: 14 },
  taskCard: { alignItems: 'center', backgroundColor: SOFT_WHITE, borderColor: SOFT_WHITE, borderRadius: 22, borderWidth: 1, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 18, color: `${EARTHY_CLAY}12` }], flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16, minHeight: 96, padding: 20 },
  taskCopy: { flex: 1, minWidth: 130 },
  taskTitle: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 20, lineHeight: 27 },
  taskDue: { color: EARTHY_CLAY, fontSize: 14, lineHeight: 21, marginTop: 6 },
  taskStatus: { backgroundColor: SOFT_BLUSH, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  taskStatusText: { color: EARTHY_CLAY, fontSize: 12 },
  noteCard: { backgroundColor: SOFT_WHITE, borderColor: SOFT_BLUSH, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, marginTop: 16, padding: 20 },
  noteText: { color: DARK_BROWN, fontSize: 15, lineHeight: 23 },
  customSectionSurface: { minHeight: 300, paddingTop: 16 },
  tinaPanel: { backgroundColor: SOFT_WHITE, borderColor: SOFT_BLUSH, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, bottom: 10, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: `${EARTHY_CLAY}14` }], overflow: 'hidden', position: 'absolute', right: 12 },
  tinaPanelClosed: { width: 142 },
  tinaPanelOpen: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, height: '62%', left: 12 },
  askTina: { alignItems: 'center', flexDirection: 'row', minHeight: 48, paddingHorizontal: 9 },
  tinaMark: { alignItems: 'center', backgroundColor: SOFT_BLUSH, borderRadius: 14, height: 30, justifyContent: 'center', width: 30 },
  tinaMarkText: { color: EARTHY_CLAY, fontSize: 16 },
  askCopy: { marginLeft: 9 },
  askTitle: { color: DARK_BROWN, fontSize: 14, fontWeight: '600' },
  tinaHeader: { alignItems: 'center', borderBottomColor: SOFT_BLUSH, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 57, paddingHorizontal: 16 },
  tinaHeaderActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  tinaTitle: { color: DARK_BROWN, fontSize: 15, fontWeight: '600' },
  tinaScope: { color: EARTHY_CLAY, fontSize: 11, marginTop: 2 },
  projectNewChatButton: { alignItems: 'center', minHeight: 36, justifyContent: 'center', paddingHorizontal: 9 },
  projectNewChatText: { color: EARTHY_CLAY, fontSize: 12, fontWeight: '600' },
  projectNewChatTextDisabled: { color: LIGHT_SAGE },
  minimizeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  minimizeText: { color: EARTHY_CLAY, fontSize: 23 },
  transcript: { flex: 1 },
  transcriptContent: { flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 12, paddingHorizontal: 14, paddingTop: 12 },
  tinaEmpty: { color: EARTHY_CLAY, fontSize: 13, lineHeight: 19, marginBottom: 8, textAlign: 'center' },
  userMessage: { alignSelf: 'flex-end', backgroundColor: USER_MESSAGE_BACKGROUND, borderRadius: 17, borderTopRightRadius: 6, marginBottom: 10, maxWidth: '84%', paddingHorizontal: 13, paddingVertical: 9 },
  assistantMessage: { alignSelf: 'flex-start', backgroundColor: ASSISTANT_MESSAGE_BACKGROUND, borderRadius: 17, marginBottom: 13, maxWidth: '90%', paddingHorizontal: 13, paddingVertical: 9 },
  userText: { color: MESSAGE_TEXT_COLOR, fontSize: 15, lineHeight: 21 },
  assistantText: { color: MESSAGE_TEXT_COLOR, fontSize: 15, lineHeight: 22 },
  thinking: { alignItems: 'center', flexDirection: 'row', gap: 5, height: 24, paddingLeft: 3 },
  dot: { backgroundColor: DARK_SAGE, borderRadius: 3, height: 5, width: 5 },
  error: { backgroundColor: SOFT_WHITE, bottom: 76, color: EARTHY_CLAY, fontSize: 12, left: 18, paddingVertical: 6, position: 'absolute', right: 18, textAlign: 'center' },
  notice: { color: EARTHY_CLAY, fontSize: 13, padding: 40, textAlign: 'center' },
  modalBackdrop: { backgroundColor: `${DARK_BROWN}66`, flex: 1, justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: SOFT_WHITE, borderColor: SOFT_BLUSH, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingBottom: 24, paddingHorizontal: 16, paddingTop: 17 },
  sheetTitle: { color: DARK_BROWN, fontSize: 18, fontWeight: '600', marginBottom: 15 },
  sheetInput: { backgroundColor: APP_BACKGROUND, borderColor: SOFT_BLUSH, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, color: DARK_BROWN, fontSize: 15, marginBottom: 11, minHeight: 47, paddingHorizontal: 13, paddingVertical: 11 },
  sheetDescription: { minHeight: 82, textAlignVertical: 'top' },
  primaryAction: { alignItems: 'center', backgroundColor: LIGHT_SAGE, borderRadius: 12, justifyContent: 'center', minHeight: 46 },
  primaryActionText: { color: DARK_BROWN, fontSize: 15, fontWeight: '600' },
  actionRow: { borderBottomColor: SOFT_BLUSH, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 50 },
  actionText: { color: DARK_BROWN, fontSize: 16 },
  destructiveText: { color: EARTHY_CLAY, fontSize: 16 },
  cancelRow: { borderBottomWidth: 0, marginTop: 7 },
  cancelText: { color: EARTHY_CLAY, fontSize: 16, textAlign: 'center' },
  filesAccess: { backgroundColor: APP_BACKGROUND, flex: 1 },
  filesAccessHeader: { alignItems: 'center', borderBottomColor: SOFT_BLUSH, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 68, paddingHorizontal: 20 },
  filesAccessTitle: { color: DARK_BROWN, fontSize: 17, fontWeight: '600' },
  filesAccessNote: { color: EARTHY_CLAY, fontSize: 11, marginTop: 3 },
  filesAccessClose: { alignItems: 'center', minHeight: 44, justifyContent: 'center', paddingLeft: 18 },
  filesAccessCloseText: { color: DARK_BROWN, fontSize: 14, fontWeight: '600' },
  filesAccessContent: { paddingTop: 8 },
  pressed: { opacity: 0.58 },
});
