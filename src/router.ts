import { createRouter, createWebHistory } from 'vue-router'
import { authPhase, authReady } from './auth'
import JobDetailView from './views/JobDetailView.vue'
import JobsView from './views/JobsView.vue'
import SignInView from './views/SignInView.vue'

// Editor, Sync center and Settings are lazy chunks on purpose; the service worker precaches
// every built chunk so they still open offline without having been visited.
const JobEditorView = () => import('./views/JobEditorView.vue')

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/jobs' },
    { path: '/sign-in', name: 'sign-in', component: SignInView, meta: { public: true } },
    { path: '/jobs', name: 'jobs', component: JobsView },
    { path: '/jobs/new', name: 'job-new', component: JobEditorView },
    { path: '/jobs/:id', name: 'job', component: JobDetailView, props: true },
    { path: '/jobs/:id/edit', name: 'job-edit', component: JobEditorView, props: true },
    { path: '/sync', name: 'sync', component: () => import('./views/SyncView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('./views/NotFoundView.vue'),
      meta: { public: true },
    },
  ],
})

router.beforeEach(async (to) => {
  await authReady
  const phase = authPhase.value
  if (phase === 'unconfigured' || phase === 'storage_error') return true
  const signedIn = phase === 'signed_in' || phase === 'opening'
  if (!signedIn && !to.meta.public) return { name: 'sign-in', query: { redirect: to.fullPath } }
  if (signedIn && to.name === 'sign-in') return { name: 'jobs' }
  return true
})
