import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    proxy: {
      // 프런트에서 /api/... 로 호출하면, 아래 타겟으로 프록시됨 → CORS 문제 X
      '/api': {
        target: 'https://api.limswoo.shop',
        changeOrigin: true,
        secure: false
      }
    }
  },
  // 여러 HTML 파일을 그대로 열어보는 용도면 MPA 모드가 편합니다.
  appType: 'mpa'
});
