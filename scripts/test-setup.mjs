// Registered before the test files load — see scripts/alias-loader.mjs.
import { register } from 'node:module'

register(new URL('./alias-loader.mjs', import.meta.url))
