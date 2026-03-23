# PBI Reference Explorer

PBI Reference Explorer is a local-first web app for scanning a Power BI PBIP project and identifying measures or calculated columns that appear unused inside the saved project.

Available at: [pbi.pulins.lv](https://pbi.pulins.lv)

The app runs entirely in the browser. Uploaded project files are analyzed locally and are not sent to external servers.

## Why This Exists

Power BI models get harder to maintain over time. Measures and calculated columns accumulate, report definitions evolve, and it becomes difficult to tell whether an object is truly unused or just indirectly referenced.

Power BI Desktop does not provide a built-in way to trace these references across the saved PBIP project and confidently identify cleanup candidates.

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
- Build model-to-model dependencies from DAX expressions
- Scan PBIR report JSON for usage in visuals, filters, bookmarks, pages, and report extensions
- Surface exact supporting evidence for every detected reference
- Flag ambiguous cases conservatively instead of overstating safety

## Privacy

- Analysis happens in the browser only
- PBIP files are not uploaded to a backend service by this app
- No semantic model data is transmitted externally as part of the analysis flow

## Scope

This app is intentionally scoped to the uploaded PBIP project only. It does not try to prove whether an object is used by:

- external reports
- Analyze in Excel
- downstream semantic models
- service-side personal bookmarks
- personalized visuals
- assets not present in the uploaded PBIP project

## Known Limitations

- Reports that point only to a remote semantic model by connection cannot be fully analyzed
- The DAX dependency parser is conservative by design
- Ambiguous unqualified references are downgraded to `Unknown`
- This version is read-only and does not modify or delete PBIP files

## Local Development

```bash
npm install
npm run dev
```

## Contributing

Contributions are welcome.

## License

This project is licensed under the MIT License.

See [LICENSE](/C:/Users/davis/Desktop/pbi-reference-explorer/LICENSE).
