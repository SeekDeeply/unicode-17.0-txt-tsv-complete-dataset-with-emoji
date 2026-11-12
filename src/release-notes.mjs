#!/usr/bin/env node
/**
 * Print release notes for the current dataset to stdout.
 * The release workflow does:  node src/release-notes.mjs > release-notes.md
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReleaseNotes } from './lib/release-notes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.stdout.write(renderReleaseNotes(ROOT));
