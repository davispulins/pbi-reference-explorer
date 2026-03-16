import { describe, expect, it } from 'vitest'

import { resolveProject } from './pbip'

describe('resolveProject', () => {
  it('excludes remote-only reports from active report roots', () => {
    const resolved = resolveProject({
      'project/report-local/definition.pbir': JSON.stringify({
        datasetReference: { byPath: { path: '../model' } },
      }),
      'project/report-remote/definition.pbir': JSON.stringify({
        datasetReference: {
          byConnection: { connectionType: 'pbiServiceXmlaStyleLive' },
        },
      }),
      'project/model/definition.pbism': JSON.stringify({ version: '1.0' }),
    })

    expect(resolved.semanticModelRoot).toBe('project/model')
    expect(resolved.reportRoots).toEqual(['project/report-local'])
    expect(
      resolved.warnings.some((warning) =>
        warning.includes('remote semantic model by connection'),
      ),
    ).toBe(true)
  })
})
