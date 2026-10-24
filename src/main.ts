import { createApp } from 'vue'
import App from './App.vue'
import { startAuth } from './auth'
import { startPwa } from './pwa'
import { router } from './router'
import './style.css'
import { startTheme } from './theme'

createApp(App).use(router).mount('#app')
startTheme()
startPwa()
void startAuth()
