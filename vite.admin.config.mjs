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
                // Hashed names on purpose: without them every release serves `assets/index.js`
                // again, and browsers keep showing the previous build after an update.
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
});
