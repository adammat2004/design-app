import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One folder per job under `MODEL_STORAGE_DIR` (gitignored): the reference, Meshy's raw output and
 * thumbnails, its task record, the processed file and the report. Kept by us because Meshy deletes
 * its copy three days after a task finishes.
 *
 * Only these names are ever written or served. The file route takes a name from a URL, and a
 * whitelist rather than a sanitiser is what makes `../../.env` impossible rather than unlikely.
 */
const NAMES =
  /^(reference\.(png|jpg)|model\.glb|processed\.glb|task\.json|report\.json|thumb(-front|-back|-left|-right)?\.png)$/;

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  glb: 'model/gltf-binary',
  json: 'application/json',
};

export class ModelStorage {
  constructor(private readonly root: string) {}

  static allowed(name: string): boolean {
    return NAMES.test(name);
  }

  static contentType(name: string): string {
    return CONTENT_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream';
  }

  private dir(jobId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error(`Not a job id: ${jobId}`);
    return join(this.root, 'jobs', jobId);
  }

  write(jobId: string, name: string, bytes: Uint8Array | string): void {
    if (!ModelStorage.allowed(name)) throw new Error(`Not a job file: ${name}`);
    const dir = this.dir(jobId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }

  read(jobId: string, name: string): Buffer | null {
    if (!ModelStorage.allowed(name)) return null;
    const path = join(this.dir(jobId), name);
    return existsSync(path) ? readFileSync(path) : null;
  }

  list(jobId: string): string[] {
    const dir = this.dir(jobId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(ModelStorage.allowed).sort();
  }

  /** The reference picture, whichever format it arrived in. */
  reference(jobId: string): { bytes: Buffer; mime: 'image/png' | 'image/jpeg' } | null {
    const png = this.read(jobId, 'reference.png');
    if (png) return { bytes: png, mime: 'image/png' };
    const jpg = this.read(jobId, 'reference.jpg');
    return jpg ? { bytes: jpg, mime: 'image/jpeg' } : null;
  }
}
