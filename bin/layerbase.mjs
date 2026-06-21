#!/usr/bin/env node
// No build step: tsx transpiles the TypeScript/JSX entry at runtime.
import { tsImport } from 'tsx/esm/api'

await tsImport('../src/cli.tsx', import.meta.url)
