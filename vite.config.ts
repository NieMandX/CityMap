import { defineConfig } from 'vite';

export default defineConfig({
    root: 'src',
    base: '/CityMap/',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        target: 'es2022',
    },
});
