import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2015',
    cssTarget: 'chrome90',   // 主题使用了 rgb(var(--x) / .5) 等现代颜色写法，避免被按 ES2015 目标改写
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  // 本地开发（npm run dev）时把接口请求转发给后端，端口与 Node 服务保持一致
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000'
    }
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false
  }
});
