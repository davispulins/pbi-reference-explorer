export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')
}

export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

export function basename(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'))
}

export function resolvePath(baseDir: string, relativePath: string): string {
  const output: string[] = []

  for (const part of normalizePath(joinPath(baseDir, relativePath)).split('/')) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      output.pop()
      continue
    }

    output.push(part)
  }

  return output.join('/')
}

export function pathStartsWith(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedPrefix = normalizePath(prefix).replace(/\/$/, '')
  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`)
  )
}
