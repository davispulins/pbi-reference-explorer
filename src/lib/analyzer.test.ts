import { describe, expect, it } from 'vitest'

import { analyzeProject } from './analyzer'

const baseFiles = {
  'project/report/definition.pbir': JSON.stringify({
    datasetReference: { byPath: { path: '../model' } },
  }),
  'project/model/definition.pbism': JSON.stringify({ version: '1.0' }),
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
    expect(totalSales?.referenceCount).toBe(1)
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
    expect(result?.referenceCount).toBe(2)
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

  it('counts a visual only once when the same object is used in values and sort', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Total Sales' = SUM ( Sales[Amount] )
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
            sortDefinition: {
              by: {
                Measure: {
                  Expression: { SourceRef: { Source: 's' } },
                  Property: 'Total Sales',
                },
              },
            },
          },
        }),
    })

    const result = bundle.results.find(
      (entry) => entry.object.id === 'Sales[Total Sales]',
    )

    expect(result?.reportUsages).toHaveLength(2)
    expect(result?.referenceCount).toBe(1)
  })

  it('keeps visual types scoped to each page visual path', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Total Sales' = SUM ( Sales[Amount] )
      `.trim(),
      'project/report/definition/pages/Overview/page.json': JSON.stringify({
        name: 'Overview',
        displayName: 'Overview',
      }),
      'project/report/definition/pages/Overview/visuals/Visual1/visual.json':
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
      'project/report/definition/pages/Details/page.json': JSON.stringify({
        name: 'Details',
        displayName: 'Details',
      }),
      'project/report/definition/pages/Details/visuals/Visual1/visual.json':
        JSON.stringify({
          visual: {
            visualType: 'lineChart',
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
    })

    const result = bundle.results.find(
      (entry) => entry.object.id === 'Sales[Total Sales]',
    )

    expect(
      result?.reportUsages.some(
        (usage) =>
          usage.pageName === 'Overview' &&
          usage.visualName === 'Visual1' &&
          usage.visualType === 'clusteredColumnChart',
      ),
    ).toBe(true)
    expect(
      result?.reportUsages.some(
        (usage) =>
          usage.pageName === 'Details' &&
          usage.visualName === 'Visual1' &&
          usage.visualType === 'lineChart',
      ),
    ).toBe(true)
  })

  it('ignores report roots that only point to a remote semantic model', () => {
    const bundle = analyzeProject({
      'project/model/definition.pbism': JSON.stringify({ version: '1.0' }),
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Total Sales' = SUM ( Sales[Amount] )
      `.trim(),
      'project/local-report/definition.pbir': JSON.stringify({
        datasetReference: { byPath: { path: '../model' } },
      }),
      'project/local-report/definition/pages/Overview/page.json': JSON.stringify({
        name: 'Overview',
        displayName: 'Overview',
      }),
      'project/remote-report/definition.pbir': JSON.stringify({
        datasetReference: { byConnection: { connectionString: 'powerbi://api' } },
      }),
      'project/remote-report/definition/pages/Overview/page.json': JSON.stringify({
        name: 'Overview',
        displayName: 'Overview',
      }),
      'project/remote-report/definition/pages/Overview/visuals/Visual1/visual.json':
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
    })

    const result = bundle.results.find(
      (entry) => entry.object.id === 'Sales[Total Sales]',
    )

    expect(bundle.project.reportRoots).toEqual(['project/local-report'])
    expect(result?.reportUsages).toHaveLength(0)
    expect(result?.referenceCount).toBe(0)
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
    expect(flag?.referenceCount).toBe(0)
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

  it('keeps multiline compact TMDL expressions before metadata properties', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  measure 'Revenue' =
    SUM ( Sales[Amount] )
    + SUM ( Sales[Tax] )
    formatString: "$#,0"
  measure 'Margin' = [Revenue]
      `.trim(),
    })

    const revenue = bundle.results.find(
      (result) => result.object.id === 'Sales[Revenue]',
    )
    const margin = bundle.results.find(
      (result) => result.object.id === 'Sales[Margin]',
    )

    expect(revenue?.object.expression).toBe(
      'SUM ( Sales[Amount] )\n+ SUM ( Sales[Tax] )',
    )
    expect(revenue?.referenceCount).toBe(1)
    expect(margin?.outboundModelRefs).toContain('Sales[Revenue]')
  })

  it('adds semantic-model relationship usage for calculated columns', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/Sales.tmdl': `
table Sales
  column 'Region Key' = Sales[RegionKey]
      `.trim(),
      'project/model/definition/tables/Region.tmdl': `
table Region
  column 'Region Key' = Region[RegionKey]
      `.trim(),
      'project/model/definition/relationships.tmdl': `
relationship SalesToRegion
  fromCardinality: many
  toCardinality: one
  crossFilteringBehavior: oneDirection
  fromColumn: Sales.Region Key
  toColumn: Region.Region Key
      `.trim(),
    })

    const salesRegionKey = bundle.results.find(
      (result) => result.object.id === 'Sales[Region Key]',
    )

    expect(salesRegionKey?.referenceCount).toBe(1)
    expect(
      salesRegionKey?.reportUsages.some(
        (usage) =>
          usage.artifactType === 'relationship' &&
          usage.relationship?.id === 'SalesToRegion' &&
          usage.relationship.fromObjectId === 'Sales[Region Key]' &&
          usage.relationship.toObjectId === 'Region[Region Key]',
      ),
    ).toBe(true)
  })

  it('parses TMDL relationships despite blank lines and property-name casing', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/A.tmdl': `
table A
  column Key = A[Key]
      `.trim(),
      'project/model/definition/tables/B.tmdl': `
table B
  column Key = B[Key]
      `.trim(),
      'project/model/definition/relationships.tmdl': `
relationship MixedCaseProps
  FromColumn: A.Key

  ToColumn: B.Key
  fromCardinality: many
  TOCARDINALITY: one
  IsActive: true
      `.trim(),
    })

    const aKey = bundle.results.find((result) => result.object.id === 'A[Key]')
    const relationshipUsage = aKey?.reportUsages.find(
      (usage) =>
        usage.artifactType === 'relationship' &&
        usage.relationship?.id === 'MixedCaseProps',
    )

    expect(relationshipUsage?.relationship?.fromObjectId).toBe('A[Key]')
    expect(relationshipUsage?.relationship?.toObjectId).toBe('B[Key]')
    expect(relationshipUsage?.relationship?.fromCardinality).toBe('many')
    expect(relationshipUsage?.relationship?.toCardinality).toBe('one')
    expect(relationshipUsage?.relationship?.isActive).toBe(true)
  })

  it('defaults a missing relationship cardinality to many when the other side is many', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/A.tmdl': `
table A
  column Key = A[Key]
      `.trim(),
      'project/model/definition/tables/B.tmdl': `
table B
  column Key = B[Key]
      `.trim(),
      'project/model/definition/relationships.tmdl': `
relationship ManyToManyExample
  fromCardinality: many
  crossFilteringBehavior: bothDirections
  fromColumn: A.Key
  toColumn: B.Key
      `.trim(),
    })

    const aKey = bundle.results.find((result) => result.object.id === 'A[Key]')
    const relationshipUsage = aKey?.reportUsages.find(
      (usage) => usage.artifactType === 'relationship',
    )

    expect(relationshipUsage?.relationship?.fromCardinality).toBe('many')
    expect(relationshipUsage?.relationship?.toCardinality).toBe('many')
  })

  it('filters auto-generated Power BI date tables from inline TMDL metadata', () => {
    const bundle = analyzeProject({
      ...baseFiles,
      'project/model/definition/tables/LocalDateTable_123.tmdl': `
table LocalDateTable_123
  annotation __PBI_LocalDateTable = true
  column Date = TODAY ()
      `.trim(),
      'project/model/definition/tables/DateTableTemplate_456.tmdl': `
table DateTableTemplate_456
  annotation __PBI_TemplateDateTable = true
  column Date = TODAY ()
      `.trim(),
    })

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
