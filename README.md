# PBIP Unused Measure and Column Analyzer

Local-first web app for scanning a Power BI PBIP project and identifying measures or calculated columns that appear unused inside the saved project.

## What it does

- Accepts a full PBIP folder through directory upload.
- Accepts a zip of a PBIP folder as a fallback.
- Resolves the report folder and semantic model folder from the uploaded project.
- Scans the semantic model for measures and calculated columns.
- Builds model-to-model dependencies from DAX expressions with a conservative parser.
- Scans PBIR report JSON for usages in visuals, filters, bookmarks, pages, and report extensions.
- Shows exact evidence for each object:
  - other measures or columns that reference it
  - report pages and visuals that use it
  - parser notes when a result cannot be proven safely
- Exports the analysis as CSV or JSON.

## Status meanings

- `Used`: a model or report reference was found.
- `UnusedCandidate`: no references were found in the saved PBIP project.
- `Unknown`: parsing found an ambiguous or unsupported case, so the app will not mark the object safe.
- `ParseError`: the object could not be parsed correctly.

## Scope

This app is intentionally scoped to the uploaded PBIP project only. It does not try to prove whether an object is used by:

- external reports
- Analyze in Excel
- downstream semantic models
- service-side personal bookmarks or personalized visuals

## Supported inputs

- Local PBIP projects where the report points to the semantic model by path
- Semantic model definitions stored as TMDL files
- Semantic model definitions stored as `model.bim`

## Known limitations

- Reports that point only to a remote semantic model by connection cannot be fully analyzed.
- The DAX dependency parser is conservative by design. Ambiguous unqualified references are downgraded to `Unknown`.
- This version is read-only. It does not modify or delete PBIP files.

## Run locally

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run lint
npm run build
```
