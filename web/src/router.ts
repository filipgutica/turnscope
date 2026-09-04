import { createRouter, createWebHashHistory } from 'vue-router'

import OverviewView from './views/OverviewView.vue'
import PatternsView from './views/PatternsView.vue'
import ProjectView from './views/ProjectView.vue'
import SessionView from './views/SessionView.vue'
import SettingsView from './views/SettingsView.vue'
import ToolHealthView from './views/ToolHealthView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView },
    { path: '/tool-health', name: 'tool-health', component: ToolHealthView },
    { path: '/projects/:id', name: 'project', component: ProjectView },
    { path: '/sessions/:id', name: 'session', component: SessionView },
    { path: '/patterns', name: 'patterns', component: PatternsView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})
