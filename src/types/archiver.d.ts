/**
 * Minimal typings for `archiver`.
 *
 * The published `@types/archiver` describes an API this version does not have:
 * it exports classes (`ZipArchive`, …) but no callable default, while the
 * runtime is exactly the other way round — `archiver('zip', opts)` works and
 * the classes do not exist. Rather than pin a mismatched types package, this
 * declares the two things Klarbild actually uses.
 */
declare module 'archiver' {
  import { Transform } from 'node:stream';

  interface ArchiverOptions {
    zlib?: { level?: number };
    store?: boolean;
  }

  interface EntryData {
    name: string;
    date?: Date | string;
  }

  interface Archiver extends Transform {
    append(source: Buffer | NodeJS.ReadableStream | string, data: EntryData): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
    on(event: 'error' | 'warning', listener: (err: Error & { code?: string }) => void): this;
    on(event: 'entry', listener: (entry: EntryData) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  function archiver(format: 'zip' | 'tar', options?: ArchiverOptions): Archiver;
  export default archiver;
}
