// Ensure the compiled CLI entry is executable as a command.
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'dist/cli.js'
const shebang = '#!/usr/bin/env node\n'
let src = readFileSync(file, 'utf8')
src = src.startsWith('#!') ? src.replace(/^#!.*\n/, shebang) : shebang + src
writeFileSync(file, src)
