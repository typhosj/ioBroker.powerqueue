import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The admin UI is a normal vite app whose build output is what ioBroker serves:
// admin/index.html + admin/assets/*. `emptyOutDir: false` keeps the hand-maintained
// files in admin/ (i18n dictionaries, icon).
export default defineConfig({
    root: 'src-admin',
    plugins: [react()],
    base: './',
    build: {
        outDir: '../admin',
        emptyOutDir: false,
        assetsDir: 'assets',
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name][extname]',
            },
        },
    },
});
