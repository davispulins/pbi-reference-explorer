# PBI Reference Explorer

PBI Reference Explorer is a local-first web app for scanning a Power BI PBIP project and identifying measures or calculated columns that appear unused inside the saved project.

The app runs entirely in the browser. Uploaded project files are analyzed locally and are not sent to external servers.

## Why This Exists

Power BI models get harder to maintain over time. Measures and calculated columns accumulate, report definitions evolve, and it becomes difficult to tell whether an object is truly unused or just indirectly referenced.

This project helps you inspect saved PBIP content and answer:

- Which measures or calculated columns are still referenced?
- Which report pages, visuals, filters, bookmarks, or report extensions use them?
- Which model objects depend on them?
- Which objects are candidates for cleanup?

## Features

- Upload a full PBIP project folder directly in the browser
- Upload a zip of the PBIP project as a fallback
- Resolve the report folder and semantic model folder from the project structure
- Scan semantic models stored as TMDL
- Scan semantic models stored as `model.bim`
- Build model-to-model dependencies from DAX expressions
- Scan PBIR report JSON for usage in visuals, filters, bookmarks, pages, and report extensions
- Surface exact supporting evidence for every detected reference
- Flag ambiguous cases conservatively instead of overstating safety

## Status Meanings

- `Used`: a model or report reference was found
- `UnusedCandidate`: no references were found in the saved PBIP project
- `Unknown`: parsing found an ambiguous or unsupported case, so the app will not mark the object safe
- `ParseError`: the object could not be parsed correctly

## Privacy

- Analysis happens in the browser only
- PBIP files are not uploaded to a backend service by this app
- No semantic model data is transmitted externally as part of the analysis flow

If you deploy the app yourself, confirm your hosting, analytics, and logging setup still matches that privacy expectation.

## Scope

This app is intentionally scoped to the uploaded PBIP project only. It does not try to prove whether an object is used by:

- external reports
- Analyze in Excel
- downstream semantic models
- service-side personal bookmarks
- personalized visuals
- assets not present in the uploaded PBIP project

## Supported Inputs

- Local PBIP projects where the report points to the semantic model by path
- Semantic model definitions stored as TMDL files
- Semantic model definitions stored as `model.bim`
- Project folder upload
- Zip upload of the same folder structure

## Known Limitations

- Reports that point only to a remote semantic model by connection cannot be fully analyzed
- The DAX dependency parser is conservative by design
- Ambiguous unqualified references are downgraded to `Unknown`
- This version is read-only and does not modify or delete PBIP files

## Example Project Shape

The analyzer expects the uploaded PBIP project to contain the usual report and model definitions. A typical structure looks like this:

```text
MyProject/
  MyProject.pbip
  report/
    definition.pbir
    definition/
      pages/
      bookmarks/
      reportExtensions.json
  model/
    definition.pbism
    definition/
      tables/
      relationships.tmdl
```

You can upload either the whole folder or a zip containing that folder structure.

## Local Development

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

## Publishing

This project builds to a static frontend, so it can be deployed to platforms such as:

- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages

For GitHub Pages, you may need to set Vite's `base` path in `vite.config.ts` to match the repository name.

## Demo

No public hosted demo is configured in this repository yet.

Until one is published, run the app locally with `npm run dev`.

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Run `npm test`, `npm run lint`, and `npm run build`
4. Open a pull request with a clear description of the change

When contributing, prefer changes that keep the analyzer conservative. A false positive that claims an object is unused is more dangerous than a result that stays uncertain.

## Repository

- Source: `https://github.com/davispulins/pbi-reference-explorer`
- Issues: `https://github.com/davispulins/pbi-reference-explorer/issues`

## License

This project is licensed under the MIT License.

See [LICENSE](/C:/Users/davis/Desktop/pbi-reference-explorer/LICENSE).
