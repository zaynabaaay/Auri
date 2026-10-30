import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as colors from '../src/colors.ts';
import * as presentation from '../src/features/projects/project-presentation.ts';
import * as composerLayout from '../src/features/home/message-composer-layout.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const AT = '2026-10-28T10:00:00.000Z';
const assignment = {
  id: 'assignment', projectId: 'arabic', title: 'Arabic assignment', status: 'todo',
  dueDate: '2026-10-30', priority: 'normal', position: 0, createdAt: AT, updatedAt: AT,
};
const defaultSection = { id: 'overview', projectId: 'arabic', title: 'Overview', isDefault: true, status: 'active', position: 0 };

async function workspace({ tasks = [assignment], notes = [], description = 'My Arabic studies.', sections = [defaultSection] } = {}) {
  const calls = [];
  const slots = [];
  let cursor = 0;
  let effects = [];
  const project = { id: 'arabic', name: 'Arabic', description, status: 'active', timezone: 'America/Toronto', updatedAt: AT };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => value !== slots[index][i])) {
        slots[index] = dependencies;
        effects.push(effect);
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const native = Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name]));
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ...native, Alert: {}, Animated: {}, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useLocalSearchParams: () => ({ id: project.id }), useRouter: () => ({ replace: (path) => calls.push(['navigate', path]) }) },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    '@/colors': colors,
    '@/typography': { HEADING_FONT_FAMILY: 'Baskerville' },
    '@/features/accessibility/use-reduced-motion': { useReducedMotion: () => true },
    '@/features/home/message-composer': { MessageComposer: 'MessageComposer' },
    '@/features/home/message-composer-layout': composerLayout,
    '@/features/home/use-visible-viewport': { useVisibleViewport: () => null },
    '@/services/assistant/assistant-service': { assistantService: { resetSession() {}, cancelRequest() {} } },
    '@/services/projects/project-client': {
      projectRepository: {
        getProject: async (id) => { calls.push(['project', id]); return project; },
        listTasks: async (id) => { calls.push(['tasks', id]); return tasks; },
        listKnowledgeItems: async (id) => { calls.push(['notes', id]); return notes; },
      },
      projectChatService: { load: async () => ({ session: { id: 'session', projectId: project.id }, entries: [] }) },
      projectService: { listSections: async () => sections },
    },
    './project-presentation': presentation,
    './project-section-assets': { ProjectSectionAssets: 'ProjectSectionAssets' },
    './project-section-navigation': { ProjectSectionNavigation: 'ProjectSectionNavigation' },
    './project-sections-manager': { ProjectSectionsManager: 'ProjectSectionsManager' },
  };
  const source = await read('../src/features/projects/project-screen.tsx');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; } });
  const flatten = (tree) => {
    if (Array.isArray(tree)) return tree.flatMap(flatten);
    if (!tree || typeof tree !== 'object') return [];
    if (typeof tree.type === 'function' && tree.type.name === 'ProjectTaskCard') return flatten(tree.type(tree.props));
    return [tree, ...flatten(tree.props?.children)];
  };
  const render = () => { cursor = 0; return flatten(module.exports.default()); };
  render();
  effects.forEach((effect) => effect());
  effects = [];
  await new Promise((resolve) => setImmediate(resolve));
  const find = (predicate) => { const node = render().find(predicate); assert.ok(node, 'Expected rendered node'); return node; };
  const byId = (id) => find((node) => node.props?.testID === id);
  const select = (id) => byId('project-view-navigation').props.onSelect({ id });
  return { render, find, byId, select, calls, project };
}

test('Project identity is centered with the existing initial, serif font, and persisted description', async () => {
  const view = await workspace();
  assert.equal(view.byId('project-identity').props.style.alignItems, 'center');
  const badge = view.byId('project-home-cover-fallback');
  assert.equal(badge.props.style.borderRadius, 32);
  const initial = badge.props.children;
  assert.equal(initial.props.children, 'A');
  assert.equal(initial.props.style.fontFamily, 'Baskerville');
  assert.equal(view.render().filter((node) => node.props?.children === view.project.description).length, 1);
  const source = await read('../src/features/projects/project-screen.tsx');
  assert.doesNotMatch(source, /coverPlane|coverRulePrimary|coverRuleSecondary|progressbar|% complete/);
});

test('Project tabs expose Overview, Tasks, Notes, and Files without creating persisted sections', async () => {
  const view = await workspace();
  assert.deepEqual(Array.from(view.byId('project-view-navigation').props.sections, ({ title }) => title), ['Overview', 'Tasks', 'Notes', 'Files']);
  assert.deepEqual(view.calls, [['project', 'arabic'], ['tasks', 'arabic'], ['notes', 'arabic']]);
});

test('Overview and Tasks render the same actual assignment, Friday deadline, and status', async () => {
  const view = await workspace();
  view.byId('project-overview-section');
  view.byId('project-task-assignment');
  assert.ok(view.render().some((node) => node.props?.children === 'Upcoming'));
  assert.ok(view.render().some((node) => node.props?.children === 'Due Friday'));
  assert.ok(view.render().some((node) => node.props?.children === 'Not started'));
  view.find((node) => node.type === 'Pressable' && node.props.children?.props?.children === 'View all ›').props.onPress();
  view.byId('project-tasks-section');
  view.byId('project-task-assignment');
  assert.equal(view.render().filter((node) => node.props?.children === assignment.title).length, 1);
});

test('empty Projects do not receive invented assignments, notes, files, or descriptions', async () => {
  const view = await workspace({ tasks: [], description: '' });
  assert.ok(view.render().some((node) => node.props?.children === 'No upcoming tasks.'));
  view.select('tasks');
  assert.ok(view.render().some((node) => node.props?.children === 'No tasks yet.'));
  view.select('notes');
  assert.ok(view.render().some((node) => node.props?.children === 'No notes yet.'));
  assert.ok(!view.render().some((node) => node.props?.children === 'Arabic assignment'));
});

test('Notes shows only current saved notes', async () => {
  const view = await workspace({ notes: [
    { id: 'one', kind: 'note', status: 'current', content: 'Saved lesson notes' },
    { id: 'old', kind: 'note', status: 'archived', content: 'Old note' },
    { id: 'fact', kind: 'fact', status: 'current', content: 'A fact' },
  ] });
  view.select('notes');
  assert.ok(view.render().some((node) => node.props?.children === 'Saved lesson notes'));
  assert.ok(!view.render().some((node) => ['Old note', 'A fact'].includes(node.props?.children)));
});

test('Files reuses original file functionality and preserves custom sections', async () => {
  const custom = { ...defaultSection, id: 'lessons', title: 'Lessons', isDefault: false };
  const view = await workspace({ sections: [defaultSection, custom] });
  view.select('files');
  const nav = view.find((node) => node.type === 'ProjectSectionNavigation' && node.props.testID === undefined);
  nav.props.onSelect(custom);
  const assets = view.find((node) => node.type === 'ProjectSectionAssets');
  assert.equal(assets.props.projectId, 'arabic');
  assert.equal(assets.props.section.id, 'lessons');
  assert.equal(assets.props.sections.length, 2);
});

test('Ask Auri retains composer and New Chat while using the approved light palette', async () => {
  const view = await workspace();
  const panel = view.byId('project-tina-control');
  assert.equal(panel.props.style[0].backgroundColor, colors.SOFT_WHITE);
  assert.equal(panel.props.style[0].right, 12);
  view.byId('open-project-tina').props.onPress();
  assert.equal(view.byId('project-tina-control').props.style[1].left, 12);
  assert.equal(view.byId('project-tina-control').props.style[1].height, '62%');
  view.find((node) => node.type === 'MessageComposer');
  view.byId('project-new-chat-button');
  assert.equal(view.byId('project-keyboard-layout').props.behavior, 'padding');
  const source = await read('../src/features/projects/project-screen.tsx');
  assert.match(source, /projectChatService\.startNewSession\(session\)/);
  assert.match(source, /projectId: project\.id/);
});

test('task presentation preserves calendar days and does not invent missing deadlines', () => {
  assert.equal(presentation.projectTaskDueLabel({}), null);
  assert.equal(presentation.projectTaskDueLabel({ dueDate: '2026-10-30' }), 'Due Friday');
  assert.equal(presentation.projectTaskStatusLabel('completed'), 'Completed');
  const tasks = [assignment, { ...assignment, id: 'done', status: 'completed' }, { ...assignment, id: 'cancelled', status: 'cancelled' }, { ...assignment, id: 'unknown', dueDate: undefined }];
  assert.deepEqual(presentation.upcomingProjectTasks(tasks).map(({ id }) => id), ['assignment']);
  assert.equal(tasks.length, 4);
});
