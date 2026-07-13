declare module 'write-file-atomic' {
  interface WriteFileAtomicOptions {
    encoding?: BufferEncoding
    mode?: number
    chown?: { uid: number; gid: number }
    fsync?: boolean
  }

  export default function writeFileAtomic(
    fileName: string,
    data: string | Buffer,
    options?: WriteFileAtomicOptions,
  ): Promise<void>
}
