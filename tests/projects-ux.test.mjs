import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

import * as colors from '../src/colors.ts';
import * as projectPresentation from '../src/features/projects/project-presentation.ts';

import { isAssistantApiRequest } from '../src/server/assistant/request-validation.ts';
import { AssistantService } from '../src/services/assistant/assistant-service.ts';
import { InMemoryProjectRepository } from '../src/services/projects/in-memory-project-repository.ts';
import { ProjectChatService } from '../src/services/projects/project-chat-service.ts';
import {
  projectDescription,
  projectFallbackInitial,
  projectLibraryCollections,
  sortProjects,
} from '../src/features/projects/project-presentation.ts';
import {
  createProjectSortPreference,
  PROJECT_SORT_PREFERENCE_KEY,
  createProjectViewPreference,
  PROJECT_VIEW_PREFERENCE_KEY,
} from '../src/features/projects/project-view-preference.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const AT = '2026-08-26T12:00:00.000Z';

async function libraryView(values, { loading = false, error = null } = {}) {
  const source = await read('../src/features/projects/projects-screen.tsx');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const state = [values, 'recent', false, loading, error];
  const routes = [];
  const savedSorts = [];
  let cursor = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    '@/colors': colors,
    '@/typography': { HEADING_FONT_FAMILY: 'Baskerville' },
    react: {
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useState: () => {
        const index = cursor++;
        return [state[index], (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        }];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': {
      useFocusEffect: () => undefined,
      useRouter: () => ({ push: (route) => routes.push(route) }),
    },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name])),
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/services/projects/project-client': { projectRepository: {} },
    './project-presentation': projectPresentation,
    './project-view-preference': {
      projectSortPreference: { save: async (sort) => { savedSorts.push(sort); } },
    },
  };
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const flatten = (tree) => {
    if (Array.isArray(tree)) return tree.flatMap(flatten);
    if (!tree || typeof tree !== 'object') return [];
    if (typeof tree.type === 'function') return flatten(tree.type(tree.props));
    return [tree, ...flatten(tree.props?.children)];
  };
  const render = () => {
    cursor = 0;
    return flatten(module.exports.default());
  };
  const byId = (id) => {
    const node = render().find((node) => node.props?.testID === id);
    assert.ok(node, `Expected ${id}`);
    return node;
  };
  return { render, byId, routes, savedSorts };
}

function project(id, status = 'active', overrides = {}) {
  return {
    createdAt: AT,
    description: `${id} description`,
    id,
    name: id === 'a' ? 'Atelier' : id === 'b' ? 'Bakery' : id,
    priority: 'normal',
    status,
    timezone: 'America/Toronto',
    type: 'general',
    updatedAt: AT,
    ...overrides,
  };
}

test('Project presentation uses persisted identity copy and a cover-free fallback', () => {
  assert.equal(projectDescription(project('a')), 'a description');
  assert.equal(projectDescription(project('a', 'active', { description: undefined })), 'No description yet.');
  assert.equal(projectFallbackInitial(project('a')), 'A');
});

test('Projects reference layout uses a centered serif heading, exact subtitle, and responsive content', async () => {
  const view = await libraryView([project('a'), project('b')]);
  const nodes = view.render();
  const heading = nodes.find((node) => node.props?.accessibilityRole === 'header');
  assert.equal(heading.props.children, 'Projects');
  assert.equal(heading.props.style.fontFamily, 'Baskerville');
  assert.equal(heading.props.style.textAlign, 'center');
  assert.ok(nodes.some((node) => node.props?.children === 'A space for the things you’re working on. I’ll keep everything organized and ready for you.'));
  const scroll = nodes.filter((node) => node.type === 'ScrollView');
  assert.equal(scroll.length, 1);
  assert.equal(scroll[0].props.contentContainerStyle.maxWidth, 720);
  assert.equal(scroll[0].props.contentContainerStyle.width, '100%');
  assert.equal(view.byId('projects-screen').props.style.backgroundColor, colors.APP_BACKGROUND);
});

test('reference cards retain real identity, description, project navigation, and accessible recency', async () => {
  const value = project('a');
  const view = await libraryView([value]);
  const row = view.byId('project-row-a');
  const style = row.props.style({ pressed: false })[0];
  assert.equal(style.borderColor, colors.SOFT_WHITE);
  assert.equal(style.borderRadius, 24);
  assert.equal(style.minHeight, 134);
  assert.equal(style.boxShadow[0].color, `${colors.EARTHY_CLAY}14`);
  assert.match(row.props.accessibilityHint, /Updated/);
  assert.ok(view.render().some((node) => node.props?.children === value.name));
  assert.ok(view.render().some((node) => node.props?.children === value.description));
  row.props.onPress();
  assert.equal(view.routes[0].pathname, '/projects/[id]');
  assert.equal(view.routes[0].params.id, value.id);
  assert.ok(!view.render().some((node) => node.props?.accessibilityRole === 'progressbar'));
});

test('circular project initials use the existing sage and blush palette', async () => {
  const view = await libraryView([project('a'), project('b')]);
  const covers = view.render().filter((node) => node.props?.testID === 'project-cover-fallback');
  const sage = Object.assign({}, ...covers[0].props.style.filter(Boolean));
  const blush = Object.assign({}, ...covers[1].props.style.filter(Boolean));
  assert.equal(sage.height, 46);
  assert.equal(sage.width, 46);
  assert.equal(sage.borderRadius, 23);
  assert.equal(sage.backgroundColor, `${colors.LIGHT_SAGE}26`);
  assert.equal(blush.backgroundColor, colors.SOFT_BLUSH);
});

test('centered New Project and sorting remain functional below the project cards', async () => {
  const view = await libraryView([project('a')]);
  const button = view.byId('new-project-button');
  assert.equal(button.props.style({ pressed: false })[0].alignSelf, 'center');
  assert.ok(view.render().some((node) => node.props?.children === '+ New Project'));
  button.props.onPress();
  assert.deepEqual(view.routes, ['/projects/new']);
  view.byId('projects-sort-name').props.onPress();
  assert.deepEqual(view.savedSorts, ['name']);
  assert.equal(view.byId('projects-sort-name').props.accessibilityState.selected, true);
});

test('restyled library retains archived navigation and loading, error, and empty states', async () => {
  const archived = await libraryView([project('a', 'archived')]);
  assert.ok(!archived.render().some((node) => node.props?.testID === 'project-row-a'));
  archived.byId('toggle-archived-projects').props.onPress();
  archived.byId('project-row-a').props.onPress();
  assert.equal(archived.routes[0].params.id, 'a');
  const loading = await libraryView([], { loading: true });
  assert.ok(loading.render().some((node) => node.type === 'ActivityIndicator'));
  const failed = await libraryView([], { error: 'Projects could not be loaded.' });
  assert.ok(failed.render().some((node) => node.props?.accessibilityRole === 'alert'));
  const empty = await libraryView([]);
  assert.ok(empty.render().some((node) => node.props?.children === 'No Projects yet'));
  empty.byId('new-project-button');
});

test('normal lifecycle statuses share one library while archived Projects remain separate', () => {
  const grouped = projectLibraryCollections([
    project('a', 'active'),
    project('b', 'paused'),
    project('c', 'archived'),
    project('d', 'planned'),
  ], 'name');
  assert.deepEqual(grouped.projects.map(({ id }) => id), ['a', 'b', 'd']);
  assert.deepEqual(grouped.archived.map(({ id }) => id), ['c']);
});

test('Recent, created, and name sorts are deterministic', () => {
  const values = [
    project('z', 'planned', { createdAt: '2026-01-01T00:00:00.000Z', name: 'Same', updatedAt: '2026-03-01T00:00:00.000Z' }),
    project('a', 'paused', { createdAt: '2026-02-01T00:00:00.000Z', name: 'Same', updatedAt: '2026-03-01T00:00:00.000Z' }),
    project('b', 'completed', { createdAt: '2026-02-01T00:00:00.000Z', name: 'Alpha', updatedAt: '2026-04-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortProjects(values, 'recent').map(({ id }) => id), ['b', 'a', 'z']);
  assert.deepEqual(sortProjects(values, 'created').map(({ id }) => id), ['b', 'a', 'z']);
  assert.deepEqual(sortProjects(values, 'name').map(({ id }) => id), ['b', 'a', 'z']);
});

test('list/grid preference loads safely and persists through the existing storage dependency', async () => {
  const values = new Map();
  const preference = createProjectViewPreference({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });
  assert.equal(await preference.load(), 'list');
  await preference.save('grid');
  assert.equal(values.get(PROJECT_VIEW_PREFERENCE_KEY), 'grid');
  assert.equal(await preference.load(), 'grid');
});

test('sort preference reuses local storage safely and defaults to Recent', async () => {
  const values = new Map();
  const preference = createProjectSortPreference({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });
  assert.equal(await preference.load(), 'recent');
  await preference.save('name');
  assert.equal(values.get(PROJECT_SORT_PREFERENCE_KEY), 'name');
  assert.equal(await preference.load(), 'name');
});

test('Project chat uses persisted work-session provenance and never leaks sessions across Projects', async () => {
  const repository = new InMemoryProjectRepository({ projects: [project('a'), project('b')] });
  let sequence = 0;
  const chat = new ProjectChatService(repository, () => new Date(Date.parse(AT) + sequence++ * 1000));
  const first = await chat.load('a');
  await chat.append(first.session, 'user_message', 'Shape the first collection', 0);
  const second = await chat.load('b');
  await chat.append(second.session, 'user_message', 'Choose the bakery name', 0);

  assert.notEqual(first.session.id, second.session.id);
  assert.deepEqual((await chat.load('a')).entries.map(({ content }) => content), ['Shape the first collection']);
  assert.deepEqual((await chat.load('b')).entries.map(({ content }) => content), ['Choose the bakery name']);
  await assert.rejects(chat.append({ ...first.session, projectId: 'b' }, 'user_message', 'Leak', 1), /no longer available/);
});

test('Project New Chat closes the current session, preserves its evidence, and opens a clean scoped session', async () => {
  const repository = new InMemoryProjectRepository({
    decisions: [{
      createdAt: AT, decidedAt: AT, id: 'decision-a', projectId: 'a',
      statement: 'Keep the program community-led.', status: 'active', updatedAt: AT,
    }],
    knowledgeItems: [{
      content: 'Who will host the showcase?', createdAt: AT, id: 'question-a',
      kind: 'question', projectId: 'a', status: 'current', updatedAt: AT,
    }],
    projects: [project('a'), project('b')],
    resources: [{
      createdAt: AT, id: 'resource-a', name: 'Program notes', projectId: 'a',
      role: 'reference', type: 'document', updatedAt: AT,
    }],
    tasks: [{
      createdAt: AT, id: 'task-a', position: 0, priority: 'normal', projectId: 'a',
      status: 'in_progress', title: 'Confirm the venue', updatedAt: AT,
    }],
  });
  let sequence = 0;
  const chat = new ProjectChatService(
    repository,
    () => new Date(Date.parse(AT) + sequence++ * 1000),
  );
  const oldA = await chat.load('a');
  await chat.append(oldA.session, 'user_message', 'What are we working on?', 0);
  await chat.append(oldA.session, 'assistant_message', 'The AQAL program direction.', 1);
  const openB = await chat.load('b');
  await chat.append(openB.session, 'user_message', 'Keep this Bakery chat.', 0);

  const freshA = await chat.startNewSession(oldA.session);

  assert.notEqual(freshA.id, oldA.session.id);
  assert.equal(freshA.projectId, 'a');
  assert.equal(freshA.endedAt, undefined);
  assert.equal((await repository.getWorkSession(oldA.session.id))?.summary, 'Project chat ended with 2 messages.');
  assert.ok((await repository.getWorkSession(oldA.session.id))?.endedAt);
  assert.deepEqual(
    (await repository.listWorkSessionEntries(oldA.session.id)).map(({ content }) => content),
    ['What are we working on?', 'The AQAL program direction.'],
  );
  assert.deepEqual((await chat.load('a')).entries, []);
  assert.equal((await chat.load('a')).session.id, freshA.id);
  assert.equal((await repository.getWorkSession(openB.session.id))?.endedAt, undefined);
  assert.deepEqual(
    (await repository.listWorkSessionEntries(openB.session.id)).map(({ content }) => content),
    ['Keep this Bakery chat.'],
  );
  assert.equal((await repository.listDecisions('a')).length, 1);
  assert.equal((await repository.listKnowledgeItems('a')).length, 1);
  assert.equal((await repository.listTasks('a')).length, 1);
  assert.equal((await repository.listResources('a')).length, 1);
  assert.deepEqual(
    (await repository.listChangeEvents('a')).map(({ eventType }) => eventType),
    ['work_session_closed'],
  );
});

test('Project New Chat can recover after the old session was closed before fresh-session creation', async () => {
  const repository = new InMemoryProjectRepository({ projects: [project('a')] });
  let sequence = 0;
  const chat = new ProjectChatService(
    repository,
    () => new Date(Date.parse(AT) + sequence++ * 1000),
  );
  const old = await chat.load('a');
  await chat.append(old.session, 'user_message', 'Preserve this evidence.', 0);
  const originalSave = repository.saveWorkSession.bind(repository);
  let failFreshCreate = true;
  repository.saveWorkSession = async (value) => {
    if (value.id !== old.session.id && failFreshCreate) {
      failFreshCreate = false;
      throw new Error('interrupted');
    }
    return originalSave(value);
  };

  await assert.rejects(chat.startNewSession(old.session), /interrupted/);
  assert.ok((await repository.getWorkSession(old.session.id))?.endedAt);
  assert.deepEqual(
    (await repository.listWorkSessionEntries(old.session.id)).map(({ content }) => content),
    ['Preserve this evidence.'],
  );

  const recovered = await chat.startNewSession(old.session);
  assert.equal(recovered.projectId, 'a');
  assert.notEqual(recovered.id, old.session.id);
  assert.deepEqual(await repository.listWorkSessionEntries(recovered.id), []);
  assert.equal((await repository.listChangeEvents('a')).length, 1);
});

test('assistant Project scope is explicit, bounded, and forwarded independently per request', async () => {
  const requests = [];
  const assistant = new AssistantService(async (request) => { requests.push(request); return 'Okay'; });
  await assistant.respond([{ content: 'Continue here', role: 'user' }], { projectId: 'a', projectName: 'Atelier' });
  await assistant.respond([{ content: 'Continue here', role: 'user' }], { projectId: 'b', projectName: 'Bakery' });
  assert.deepEqual(requests.map((request) => request.projectScope?.projectId), ['a', 'b']);
  assert.deepEqual(requests.map((request) => request.projectScope?.projectName), ['Atelier', 'Bakery']);
  assert.equal(isAssistantApiRequest(requests[0]), true);
  assert.equal(isAssistantApiRequest({ ...requests[0], projectScope: { projectId: '' } }), false);
});

test('Projects library is a continuous recency-driven collection without status hierarchy', async () => {
  const [library, creation] = await Promise.all([
    read('../src/features/projects/projects-screen.tsx'),
    read('../src/features/projects/new-project-screen.tsx'),
  ]);
  const item = library.slice(library.indexOf('function ProjectRow'), library.indexOf('export default function ProjectsScreen'));
  assert.match(item, /project\.name/);
  assert.match(item, /projectDescription\(project\)/);
  assert.doesNotMatch(item, /project\.status|task|progress|file/i);
  assert.match(item, /projectRecencyLabel\(project\.updatedAt\)/);
  assert.match(library, /testID="projects-library"/);
  assert.match(library, /label: 'Recent', value: 'recent'/);
  assert.match(library, /label: 'Created', value: 'created'/);
  assert.match(library, /label: 'Name', value: 'name'/);
  assert.doesNotMatch(library, /title="Active"|title="Other"|projects-section-active|projects-section-other/);
  assert.doesNotMatch(library, /quietSection|opacity: 0\.78/);
  assert.match(library, /testID="project-cover-fallback"/);
  assert.match(library, /testID="projects-archive-section"/);
  assert.match(creation, /projectService\.createProject/);
  assert.match(creation, /description: description\.trim\(\)/);
  assert.match(creation, /status: 'active'/);
  assert.doesNotMatch(creation, /milestone|template|progress|category/i);
});

test('opening a Project enters an identity-first workspace with Overview', async () => {
  const [screen, route] = await Promise.all([
    read('../src/features/projects/project-screen.tsx'),
    read('../src/app/projects/[id]/index.tsx'),
  ]);
  assert.match(route, /ProjectScreen/);
  assert.match(screen, /testID="project-identity"/);
  assert.match(screen, /project\.name/);
  assert.match(screen, /project\.description/);
  assert.match(screen, /testID="project-home-cover-fallback"/);
  assert.match(screen, /testID="project-overview-section"/);
  assert.match(screen, /<ProjectSectionNavigation/);
  assert.doesNotMatch(screen, /open-project-workspace|pathname: '\/projects\/\[id\]\/workspace'/);
});

test('Project-scoped Auri expands inside the workspace and reuses composer behavior', async () => {
  const screen = await read('../src/features/projects/project-screen.tsx');
  assert.match(screen, /testID="project-tina-control"/);
  assert.match(screen, /testID="open-project-tina"/);
  assert.match(screen, /<MessageComposer/);
  assert.match(screen, /messageSendEnabled\(draft/);
  assert.match(screen, /KeyboardAvoidingView/);
  assert.match(screen, /projectId: project\.id/);
  assert.match(screen, /projectName: project\.name/);
  assert.match(screen, /projectChatService\.load\(id\)/);
  assert.match(screen, /tinaOpen \? styles\.tinaPanelOpen : styles\.tinaPanelClosed/);
  assert.match(screen, /tinaPanelClosed: \{ width: 142 \}/);
  assert.match(screen, /tinaPanelOpen: \{[^}]*height: '62%'[^}]*left: 12/);
  assert.match(screen, /tinaPanel: \{[^\n]*right: 12/);
  assert.doesNotMatch(screen, /tinaPanelOpen: \{[^}]*width:/);
  assert.doesNotMatch(screen, /width: undefined/);
  assert.doesNotMatch(screen, /Right now|current state|current context/i);
});

test('Project Ask Auri exposes a non-destructive scoped New Chat without touching main or other drafts', async () => {
  const [projectScreen, homeScreen] = await Promise.all([
    read('../src/features/projects/project-screen.tsx'),
    read('../src/features/home/home-screen.tsx'),
  ]);
  const start = projectScreen.indexOf('const startNewChat = async');
  const end = projectScreen.indexOf('\n\n  return (', start);
  const action = projectScreen.slice(start, end);

  assert.match(projectScreen, /testID="project-new-chat-button"/);
  assert.match(projectScreen, />\{startingNewChat \? 'Starting…' : 'New Chat'\}<\/Text>/);
  assert.doesNotMatch(projectScreen, />Clear<|accessibilityLabel="Clear/i);
  assert.match(action, /projectChatService\.startNewSession\(session\)/);
  assert.match(action, /setSession\(freshSession\)/);
  assert.match(action, /setEntries\(\[\]\)/);
  assert.match(action, /setDraft\(''\)/);
  assert.match(action, /assistantService\.resetSession\(\)/);
  assert.doesNotMatch(action, /activeConversationOutbox|conversationService|router|setProject/);
  assert.match(projectScreen, /projectId: project\.id/);
  assert.match(projectScreen, /projectName: project\.name/);
  assert.match(homeScreen, /testID="new-chat-button"/);
  assert.match(homeScreen, /finishConversationLifecycle/);
  assert.doesNotMatch(homeScreen, /projectChatService/);
});

test('section navigation is backed by genuine persisted Project sections', async () => {
  const [navigation, screen, types, service] = await Promise.all([
    read('../src/features/projects/project-section-navigation.tsx'),
    read('../src/features/projects/project-screen.tsx'),
    read('../src/domain/projects/project-types.ts'),
    read('../src/services/projects/project-service.ts'),
  ]);
  assert.match(navigation, /sections: readonly ProjectSectionDefinition\[\]/);
  assert.match(navigation, /sections\.map/);
  assert.match(screen, /projectService\.listSections\(id\)/);
  assert.match(screen, /sections=\{activeSections\}/);
  assert.match(types, /export type ProjectSection/);
  assert.match(service, /ensureOverviewSection/);
  assert.doesNotMatch(screen, /Materials|Manufacturers|Budget|Characters|Artwork|Venue/);
  assert.doesNotMatch(types, /Materials|Manufacturers|Budget|Characters|Artwork|Venue/);
});

test('the Project detail tabs retain the retired Workspace redirect', async () => {
  const [screen, retiredRoute] = await Promise.all([
    read('../src/features/projects/project-screen.tsx'),
    read('../src/app/projects/[id]/workspace.tsx'),
  ]);
  assert.match(screen, /id: 'overview', title: 'Overview'/);
  assert.match(screen, /id: 'tasks', title: 'Tasks'/);
  assert.match(screen, /id: 'notes', title: 'Notes'/);
  assert.match(screen, /id: 'files', title: 'Files'/);
  assert.match(retiredRoute, /<Redirect/);
  assert.match(retiredRoute, /pathname: '\/projects\/\[id\]'/);
});

test('structured intelligence and provenance remain in authoritative repositories', async () => {
  const [repository, processor, types] = await Promise.all([
    read('../src/services/projects/project-repository.ts'),
    read('../src/services/conversations/conversation-project-processor.ts'),
    read('../src/domain/projects/project-types.ts'),
  ]);
  assert.match(repository, /listDecisions/);
  assert.match(repository, /listKnowledgeItems/);
  assert.match(repository, /listTasks/);
  assert.match(repository, /listResources/);
  assert.match(repository, /listWorkSessions/);
  assert.match(repository, /listWorkSessionEntries/);
  assert.match(types, /sourceConversationId/);
  assert.match(types, /sourceSessionId/);
  assert.match(processor, /ConversationProjectProcessor/);
});

test('Project presentation adds no cover upload, fake state, or extraction rewrite', async () => {
  const [types, service, screen] = await Promise.all([
    read('../src/domain/projects/project-types.ts'),
    read('../src/services/projects/project-service.ts'),
    read('../src/features/projects/project-screen.tsx'),
  ]);
  assert.doesNotMatch(types, /cover|idea/i);
  assert.doesNotMatch(service, /cover|idea/i);
  assert.doesNotMatch(screen, /generate.*state|synthesi[sz]e|decision.*task.*question/i);
});
