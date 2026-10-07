// Lets `node --test` resolve the "@/" alias the app is written in.
//
// Most of src/ imports as "@/lib/permissions". tsconfig and Next understand
// that; Node does not, so every module using it was untestable — which is why
// the bot's write handlers, the part that actually changes an agency's data,
// had no tests at all. Rewriting those imports to relative paths across the
// codebase would be a large change to production code for the sake of the test
// runner. A resolver hook is the small change instead.
//
// Registered by scripts/test-setup.mjs, which package.json's test script
// --imports. Test files themselves need no change.

import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

// The extensions to try, in the order TypeScript would.
const CANDIDATES = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']

// next/server cannot be resolved outside Next's build, and a handler that
// imports after() should still be testable. See scripts/stubs/next-server.mjs.
const STUBS = { 'next/server': 'scripts/stubs/next-server.mjs' }

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(join(ROOT, STUBS[specifier])).href, shortCircuit: true }
  }
  if (specifier.startsWith('@/')) {
    const base = join(ROOT, 'src', specifier.slice(2))
    // An explicit extension is honoured as written — but only for a real FILE.
    // A folder that shares a module's name ("matching/" beside "matching.ts")
    // must not win, or Node tries to read the folder and dies with EISDIR.
    if (existsSync(base) && statSync(base).isFile()) return { url: pathToFileURL(base).href, shortCircuit: true }
    for (const ext of CANDIDATES) {
      const file = base + ext
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
  }

  // A relative import with no extension — "./cloud" — which TypeScript allows
  // and Node's ESM resolver does not.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL))
    for (const ext of CANDIDATES) {
      const file = base + ext
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
