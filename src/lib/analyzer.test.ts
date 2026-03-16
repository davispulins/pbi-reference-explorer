import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { analyzeProject } from './analyzer'

const baseFiles = {
  'project/report/definition.pbir': JSON.stringify({
    datasetReference: { byPath: { path: '../model' } },
  }),
  'project/model/definition.pbism': JSON.stringify({ version: '1.0' }),
}

function readDirectoryAsFileMap(root: string): Record<string, string> {
  const output: Record<string, string> = {}

  function walk(currentPath: string) {
    for (const entry of readdirSync(currentPath)) {
      const fullPath = path.join(currentPath, entry)
      const stats = statSync(fullPath)

      if (stats.isDirectory()) {
        walk(fullPath)
        continue
      }

      const relativePath = path
        .relative(root, fullPath)
        .replace(/\\/g, '/')
      output[relativePath] = readFileSync(fullPath, 'utf8')
    }
  }

  walk(root)
  return output
}

describe('analyzeProject', () => {
  it('marks an object as Used when another measure depends on it', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Total Sales' = SUM ( Sales[Amount] )
  measure 'Consumer Total' = [Total Sales]
      `.trim(),
    })

    const totalSales = bundle.results.find(
      (result) => result.object.id === 'Sales[Total Sales]',
    )
    const consumerTotal = bundle.results.find(
      (result) => result.object.id === 'Sales[Consumer Total]',
    )

    expect(totalSales?.status).toBe('Used')
    expect(totalSales?.inboundModelRefs).toContain('Sales[Consumer Total]')
    expect(consumerTotal?.outboundModelRefs).toContain('Sales[Total Sales]')
  })

  it('finds report usage from visual fields and report extension references', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Total Sales' = SUM ( Sales[Amount] )
  column 'Calc Region' = Sales[Region]
      `.trim(),
      'project/report/definition/pages/ReportSection/page.json': JSON.stringify({
        name: 'ReportSection',
        displayName: 'Overview',
      }),
      'project/report/definition/pages/ReportSection/visuals/Visual1/visual.json':
        JSON.stringify({
          visual: {
            visualType: 'clusteredColumnChart',
          },
          query: {
            From: [{ Name: 's', Entity: 'Sales' }],
            queryState: {
              Values: {
                projections: [
                  {
                    field: {
                      Measure: {
                        Expression: { SourceRef: { Source: 's' } },
                        Property: 'Total Sales',
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      'project/report/definition/reportExtensions.json': JSON.stringify({
        entities: [
          {
            name: 'Sales',
            measures: [
              {
                name: 'Extended KPI',
                expression: '[Total Sales]',
                references: {
                  measures: [{ entity: 'Sales', name: 'Total Sales' }],
                },
              },
            ],
          },
        ],
      }),
    })

    const result = bundle.results.find(
      (entry) => entry.object.id === 'Sales[Total Sales]',
    )

    expect(result?.status).toBe('Used')
    expect(result?.reportUsages).toHaveLength(3)
    expect(
      result?.reportUsages.some(
        (usage) =>
          usage.visualName === 'Visual1' &&
          usage.visualType === 'clusteredColumnChart',
      ),
    ).toBe(true)
    expect(
      result?.reportUsages.some(
        (usage) => usage.artifactType === 'reportExtension',
      ),
    ).toBe(true)
  })

  it('marks ambiguous unqualified references as Unknown', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Revenue' = SUM ( Sales[Amount] )
  column 'Revenue' = Sales[Amount]
  column 'Flag' = [Revenue]
      `.trim(),
    })

    const flag = bundle.results.find((result) => result.object.id === 'Sales[Flag]')

    expect(flag?.status).toBe('Unknown')
    expect(flag?.notes.join(' ')).toMatch(/ambiguous/i)
  })

  it('does not include lineageTag or formatString in compact TMDL expressions', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Revenue' = SUM ( Sales[Amount] )
    formatString: "$#,0"
    lineageTag: 123456
      `.trim(),
    })

    const revenue = bundle.results.find(
      (result) => result.object.id === 'Sales[Revenue]',
    )

    expect(revenue?.object.expression).toBe('SUM ( Sales[Amount] )')
  })

  it('filters auto-generated Power BI date tables from the sample project', () => {
    const sampleRoot = path.resolve(
      process.cwd(),
      'example inputs',
      'pbi project file',
    )
    const bundle = analyzeProject(readDirectoryAsFileMap(sampleRoot))

    expect(bundle.results.length).toBe(0)
    expect(
      bundle.results.some((result) =>
        /^LocalDateTable_|^DateTableTemplate_/i.test(result.object.table),
      ),
    ).toBe(false)
    expect(
      bundle.project.autoHiddenTables.some((table) =>
        /^LocalDateTable_|^DateTableTemplate_/i.test(table),
      ),
    ).toBe(true)
  })
})
