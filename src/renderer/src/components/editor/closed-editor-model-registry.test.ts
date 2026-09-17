// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attachModelLifetimeView,
  createModelLifetimeFixture,
  modelLifetimeFile,
  modelLifetimeTextModel,
  resetModelLifetimeFixtures
} from './editor-model-lifetime-fixture'
import { getDiffViewerMonacoModelPaths } from './diff-monaco-model-disposal'
import { scrollTopCache, pdfViewPositionCache } from '@/lib/scroll-cache'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
afterEach(resetModelLifetimeFixtures)

it('does not replay earlier model-disposal authority after first registry registration', async () => {
  const { store, bridge, attach } = createModelLifetimeFixture(false)
  const file = modelLifetimeFile('unloaded')
  attach()
  store.setState({ openFiles: [file] })
  store.getState().closeFile(file.id)
  const model = modelLifetimeTextModel(file.filePath)
  const unregister = bridge.register(monaco)
  try {
    await Promise.resolve()
    expect(model.isDisposed()).toBe(false)
    store.setState({ openFiles: [file] })
    store.getState().closeFile(file.id)
    await Promise.resolve()
    expect(model.isDisposed()).toBe(true)
  } finally {
    unregister()
  }
})

it('does not let a stale HMR unregister clear a successor registration', async () => {
  const { store, bridge, attach, add } = createModelLifetimeFixture(false)
  const unregisterOld = bridge.register(monaco)
  attach()
  const unregisterNew = bridge.register(monaco)
  unregisterOld()
  try {
    expect(bridge.get()).toBe(monaco)
    const { file, model } = add('hmr-successor')
    store.getState().closeFile(file.id)
    await Promise.resolve()
    expect(model.isDisposed()).toBe(true)
  } finally {
    unregisterNew()
  }
})

it('releases generated closed diff namespaces after detachment and preserves sibling prefixes', async () => {
  const { store, attach } = createModelLifetimeFixture()
  const file = modelLifetimeFile('diff-a', 'diff')
  const sibling = modelLifetimeFile('diff-a-longer', 'diff')
  const paths = getDiffViewerMonacoModelPaths({
    modelKey: file.id,
    generationSuffix: ':large-diff-generation:2'
  })
  const siblingPaths = getDiffViewerMonacoModelPaths({
    modelKey: sibling.id,
    generationSuffix: ''
  })
  const original = modelLifetimeTextModel(paths.originalModelPath)
  const modified = modelLifetimeTextModel(paths.modifiedModelPath)
  const live = modelLifetimeTextModel(siblingPaths.originalModelPath)
  const detachView = attachModelLifetimeView(original)
  store.setState({ openFiles: [file, sibling] })
  attach()
  store.getState().closeFile(file.id)
  await Promise.resolve()
  expect(original.isDisposed()).toBe(false)
  expect(modified.isDisposed()).toBe(true)
  expect(live.isDisposed()).toBe(false)
  detachView()
  expect(original.isDisposed()).toBe(false)
  await Promise.resolve()
  expect(original.isDisposed()).toBe(true)
  expect(live.isDisposed()).toBe(false)
})

it('retires cold-registry rich, preview and PDF caches while preserving a live sibling', async () => {
  const { store, bridge, attach } = createModelLifetimeFixture(false)
  const file = modelLifetimeFile('cold-rich')
  const preview = modelLifetimeFile('cold-preview', 'markdown-preview')
  const sibling = modelLifetimeFile('cold-live')
  store.setState({ openFiles: [file, preview, sibling] })
  attach()
  scrollTopCache.set(`${file.filePath}:rich`, 10)
  scrollTopCache.set(`${file.filePath}::pane`, 11)
  scrollTopCache.set(`${preview.id}:preview`, 12)
  scrollTopCache.set(`${preview.id}::pane`, 13)
  scrollTopCache.set(`${sibling.filePath}:rich`, 14)
  const position = { pageNumber: 2, top: 3, left: 4 }
  pdfViewPositionCache.set(`${file.filePath}:pdf`, position)
  pdfViewPositionCache.set(`${file.filePath}::pane:pdf`, position)
  pdfViewPositionCache.set(`${sibling.filePath}:pdf`, position)
  store.getState().closeFile(file.id)
  store.getState().closeFile(preview.id)
  await Promise.resolve()
  expect(bridge.get()).toBeNull()
  expect([...scrollTopCache]).toEqual([[`${sibling.filePath}:rich`, 14]])
  expect([...pdfViewPositionCache]).toEqual([[`${sibling.filePath}:pdf`, position]])
})
