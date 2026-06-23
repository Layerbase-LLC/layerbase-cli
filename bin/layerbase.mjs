#!/usr/bin/env node
// No build step: tsx transpiles the TypeScript/JSX entry at runtime.
// Point tsx at our shipped tsconfig so it uses the automatic JSX runtime even
// when installed under node_modules (tsx ignores a tsconfig it finds inside
// node_modules during its normal walk-up, which otherwise defaults JSX to the
// classic runtime and crashes with "React is not defined").
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { tsImport } from 'tsx/esm/api'

process.env.TSX_TSCONFIG_PATH = fileURLToPath(
  new URL('../tsconfig.json', import.meta.url),
)

await tsImport('../src/cli.tsx', import.meta.url)
