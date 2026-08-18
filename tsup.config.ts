import { defineConfig } from 'tsup'

// dependencies / peerDependencies 会被 tsup 自动视为 external：
// cordis 与 @deepseek-ai/* 必须共享 profile 中的单一实例，绝不可打进 bundle。
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
})
