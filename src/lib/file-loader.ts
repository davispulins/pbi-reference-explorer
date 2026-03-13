import JSZip from 'jszip'

import type { FileMap } from '../types'
import { normalizePath } from './path'

const TEXT_FILE_PATTERN =
  /\.(bim|json|pbip|pbir|pbism|tmdl|txt|md)$/i

async function readTextFile(file: File): Promise<string> {
  return file.text()
}

function shouldReadFile(path: string): boolean {
  return TEXT_FILE_PATTERN.test(path)
}

export async function readDirectorySelection(files: FileList): Promise<FileMap> {
  const entries = Array.from(files)
  const output: FileMap = {}

  await Promise.all(
    entries.map(async (file) => {
      const relativePath = normalizePath(file.webkitRelativePath || file.name)

      if (!shouldReadFile(relativePath)) {
        return
      }

      output[relativePath] = await readTextFile(file)
    }),
  )

  return output
}

export async function readZipFile(file: File): Promise<FileMap> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const output: FileMap = {}

  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) {
        return
      }

      const normalizedPath = normalizePath(entry.name)

      if (!shouldReadFile(normalizedPath)) {
        return
      }

      output[normalizedPath] = await entry.async('text')
    }),
  )

  return output
}
