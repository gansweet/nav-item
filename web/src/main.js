import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './styles/themes.css';
import { initTheme } from './composables/useTheme';

createApp(App).use(router).mount('#app');

// 访客自己选择的主题优先，否则使用站点默认主题
initTheme();
