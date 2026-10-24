// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { session, type Session } from '../../src/auth'
import { createJob } from '../../src/jobs'
import JobEditorView from '../../src/views/JobEditorView.vue'
import { newDb, sampleFields } from './helpers'

const dbs: Dexie[] = []
afterEach(async () => {
  session.value = null
  for (const db of dbs.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

function fakeSession(): Session {
  const db = newDb()
  dbs.push(db)
  const requests: string[] = []
  return {
    generation: 1,
    uid: 'user-a',
    ownerId: 'user-a',
    email: 'tech@example.test',
    projectId: 'demo-fieldlog',
    deviceId: 'device-a',
    db,
    sync: {} as Session['sync'],
    requestSync: (r: string) => requests.push(r),
  }
}

async function mountEditor(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/jobs', component: { template: '<p>list</p>' } },
      { path: '/jobs/new', component: JobEditorView },
      { path: '/jobs/:id/edit', component: JobEditorView, props: true },
      { path: '/jobs/:id', component: { template: '<p>detail</p>' } },
    ],
  })
  await router.push(path)
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.find('form').exists()).toBe(true))
  return { wrapper, router }
}

describe('job editor form', () => {
  it('creates a job through the form and stores it with its queue entry', async () => {
    const s = (session.value = fakeSession())
    const { wrapper, router } = await mountEditor('/jobs/new')
    await wrapper.find('#f-title').setValue('Replace thermostat')
    await wrapper.find('#f-customerName').setValue('Harbour Cafe')
    await wrapper.find('#f-dueDate').setValue('2026-11-05')
    expect(wrapper.text()).toContain('Unsaved changes')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.path).not.toBe('/jobs/new'))

    const [job] = await s.db.jobs.toArray()
    expect(job?.view.fields).toMatchObject({
      title: 'Replace thermostat',
      customerName: 'Harbour Cafe',
      dueDate: '2026-11-05',
    })
    expect(await s.db.outbox.count()).toBe(1)
    expect(router.currentRoute.value.fullPath).toBe(`/jobs/${job!.id}`)
    wrapper.unmount()
  })

  it('shows field errors, focuses the first one and stores nothing', async () => {
    const s = (session.value = fakeSession())
    const { wrapper } = await mountEditor('/jobs/new')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('f-title'))
    const title = wrapper.find('#f-title')
    expect(title.attributes('aria-invalid')).toBe('true')
    expect(title.attributes('aria-describedby')).toBe('title-error')
    expect(wrapper.find('#title-error').text()).toMatch(/required/)
    expect(await s.db.jobs.count()).toBe(0)
    wrapper.unmount()
  })

  it('T40: a failed local save keeps the form input and reports the failure', async () => {
    const s = (session.value = fakeSession())
    s.db.outbox.hook('creating', () => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const { wrapper, router } = await mountEditor('/jobs/new')
    await wrapper.find('#f-title').setValue('Leak check')
    await wrapper.find('#f-customerName').setValue('Dock 4')
    await wrapper.find('#f-notes').setValue('Bring the long ladder')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="save-error"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="save-error"]').text()).toMatch(/out of storage space/)
    expect((wrapper.find('#f-notes').element as HTMLTextAreaElement).value).toBe(
      'Bring the long ladder',
    )
    expect(router.currentRoute.value.fullPath).toBe('/jobs/new')
    expect(await s.db.jobs.count()).toBe(0)
    wrapper.unmount()
  })

  it('editing saves only the changed field', async () => {
    const s = (session.value = fakeSession())
    const id = await createJob(s, sampleFields())
    const { wrapper } = await mountEditor(`/jobs/${id}/edit`)
    expect((wrapper.find('#f-title').element as HTMLInputElement).value).toBe('Boiler inspection')
    await wrapper.find('#f-notes').setValue('Flue checked')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(async () => expect(await s.db.outbox.count()).toBe(2))
    const last = (await s.db.outbox.toArray()).at(-1)!
    expect(last.payload).toMatchObject({
      kind: 'patch',
      patch: { notes: 'Flue checked' },
      baseValues: { notes: '' },
    })
    wrapper.unmount()
  })
})
