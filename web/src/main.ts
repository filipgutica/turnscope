import { createApp } from 'vue'

import App from './App.vue'
import { apiKey, consumeApiToken, createApiClient, selectApiClient } from './api'
import { router } from './router'
import './styles.css'

const api = selectApiClient({
  electronApi: window.turnscope,
  createBrowserApi: () => {
    const token = consumeApiToken({ location: window.location, history: window.history })
    return createApiClient({ token })
  },
})

createApp(App)
  .provide(apiKey, api)
  .use(router)
  .mount('#app')
