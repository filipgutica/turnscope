import { createRouter, createWebHashHistory } from 'vue-router'

import OverviewView from './views/OverviewView.vue'
import PatternsView from './views/PatternsView.vue'
import ProjectView from './views/ProjectView.vue'
import SessionView from './views/SessionView.vue'
import SettingsView from './views/SettingsView.vue'
import ToolDetailView from './views/ToolDetailView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'activity', component: OverviewView },
    { path: '/overview', redirect: { name: 'activity' } },
    { path: '/tool-health', redirect: { name: 'activity' } },
    { path: '/tools/:category', name: 'tool-detail', component: ToolDetailView },
    { path: '/projects/:id', name: 'project', component: ProjectView },
    { path: '/sessions/:id', name: 'session', component: SessionView },
    { path: '/patterns', redirect: { name: 'patterns' } },
    { path: '/settings/diagnostics', name: 'patterns', component: PatternsView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})
