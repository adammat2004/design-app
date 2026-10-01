import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ModelLibraryEntrySchema,
  ModelLibrarySchema,
  type ModelLibrary,
  type ModelLibraryEntry,
} from '@garden-studio/ar-contract';
import {
  createIO,
  inspect,
  sha256,
  STRUCTURE_BUDGETS,
  thumbnail,
  validateGlb,
  webp,
} from '@garden-studio/model-pipeline';

/**
 * Writing to the model library — `apps/web/public/models/library/` and its `library.json` — for the
 * model lab and for `models:publish` alike, so there is one implementation of what publishing means.
 *
 * What it writes is for a person to review and commit: nothing here touches git. **An id is
 * immutable once published** (the contract's promise), so publishing over one is refused unless the
 * caller says `replace`, and the same bytes under a second id are refused outright.
 */

export interface LibraryPaths {
  /** The web app's `public/`. */
  publicDir: string;
}

const libraryDir = (paths: LibraryPaths) => join(paths.publicDir, 'models', 'library');
const referencesDir = (paths: LibraryPaths) => join(paths.publicDir, 'models', 'references');
const libraryFile = (paths: LibraryPaths) => join(libraryDir(paths), 'library.json');

export function readLibrary(paths: LibraryPaths): ModelLibrary {
  const file = libraryFile(paths);
  if (!existsSync(file)) return { version: 1, entries: [] };
  return ModelLibrarySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

function writeLibrary(paths: LibraryPaths, library: ModelLibrary): void {
  const sorted = {
    ...library,
    entries: [...library.entries].sort((a, b) => a.id.localeCompare(b.id)),
  };
  ModelLibrarySchema.parse(sorted);
  mkdirSync(libraryDir(paths), { recursive: true });
  writeFileSync(libraryFile(paths), `${JSON.stringify(sorted, null, 2)}\n`);
}

export class LibraryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryConflictError';
  }
}

export interface PublishInput {
  entry: ModelLibraryEntry;
  glb: Uint8Array;
  /** Meshy's three-quarter render, made into the chooser's thumbnail. */
  thumbnailPng: Uint8Array | null;
  /** The picture it was generated from, kept for provenance. */
  reference: Uint8Array;
  replace?: boolean;
}

/** Write the files and the entry. Throws `LibraryConflictError` and writes nothing on a clash. */
export async function publishToLibrary(
  paths: LibraryPaths,
  input: PublishInput,
): Promise<ModelLibraryEntry> {
  const entry = ModelLibraryEntrySchema.parse(input.entry);
  const library = readLibrary(paths);
  if (library.entries.some((existing) => existing.id === entry.id) && !input.replace) {
    throw new LibraryConflictError(
      `${entry.id} is already published. Ids are immutable once something has drawn them — ` +
        'publish under a new id, or replace it only if nothing has consumed it yet.',
    );
  }
  const twin = library.entries.find(
    (existing) => existing.sha256 === entry.sha256 && existing.id !== entry.id,
  );
  if (twin) throw new LibraryConflictError(`The same file is already published as ${twin.id}.`);

  mkdirSync(libraryDir(paths), { recursive: true });
  mkdirSync(referencesDir(paths), { recursive: true });
  writeFileSync(join(libraryDir(paths), `${entry.id}.glb`), input.glb);
  if (entry.thumbnail && input.thumbnailPng) {
    writeFileSync(join(libraryDir(paths), `${entry.id}.webp`), await thumbnail(input.thumbnailPng));
  }
  writeFileSync(join(referencesDir(paths), `${entry.id}.webp`), await webp(input.reference));
  writeLibrary(paths, {
    ...library,
    entries: [...library.entries.filter((other) => other.id !== entry.id), entry],
  });
  return entry;
}

/** Every published file re-read: missing, drifted, invalid, over budget, or orphaned. */
export async function auditLibrary(
  paths: LibraryPaths,
): Promise<{ entries: number; bytes: number; failures: string[] }> {
  const library = readLibrary(paths);
  const io = await createIO();
  const failures: string[] = [];
  const known = new Set<string>(['library.json']);

  for (const entry of library.entries) {
    known.add(`${entry.id}.glb`);
    if (entry.thumbnail) known.add(`${entry.id}.webp`);
    const path = join(paths.publicDir, entry.file);
    if (!existsSync(path)) {
      failures.push(`missing ${entry.file}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (sha256(bytes) !== entry.sha256) failures.push(`${entry.file} has drifted from its sha256`);
    if (bytes.length !== entry.bytes)
      failures.push(`${entry.file} is ${bytes.length} bytes, not ${entry.bytes}`);
    const validation = await validateGlb(bytes);
    if (validation.errors > 0)
      failures.push(`${entry.file} fails the validator: ${validation.messages.join('; ')}`);
    const found = inspect(await io.readBinary(bytes));
    if (found.counts.triangles > STRUCTURE_BUDGETS.triangles) {
      failures.push(`${entry.id} has ${found.counts.triangles} triangles`);
    }
    if (found.maxTexturePx > STRUCTURE_BUDGETS.maxTexturePx) {
      failures.push(`${entry.id} has a ${found.maxTexturePx} px texture`);
    }
    if (entry.thumbnail && !existsSync(join(paths.publicDir, entry.thumbnail))) {
      failures.push(`missing ${entry.thumbnail}`);
    }
    if (!existsSync(join(referencesDir(paths), `${entry.id}.webp`))) {
      failures.push(`missing models/references/${entry.id}.webp`);
    }
  }
  if (existsSync(libraryDir(paths))) {
    for (const file of readdirSync(libraryDir(paths))) {
      if (!known.has(file)) failures.push(`models/library/${file} is in no library entry`);
    }
  }
  const bytes = library.entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { entries: library.entries.length, bytes, failures };
}
