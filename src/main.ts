import { createApp } from 'vue'
import App from './App.vue'
import { startAuth } from './auth'
import { startPwa } from './pwa'
import { router } from './router'
import './style.css'

createApp(App).use(router).mount('#app')
startPwa()
void startAuth()
