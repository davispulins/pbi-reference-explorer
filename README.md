# PBI Reference Explorer

PBI Reference Explorer is a small local-first web app for checking a Power BI PBIP project and finding measures or calculated columns that seem unused in the saved project files.

Live version: [pbi.pulins.lv](https://pbi.pulins.lv)

The app runs in the browser. Files stay local and are not uploaded to a backend.

## What It Does

When a Power BI model grows, it gets harder to tell what is still used and what is just left over from old, unused visuals.

Power BI Desktop does not really give a simple built-in way to trace those references across a saved PBIP project.

This tool is meant to help answer questions like:

- Which measures or calculated columns are still referenced?
- Where are they referenced in the report?
- Which model objects depend on them?
- Which objects might be safe cleanup candidates?

## Features

- Upload a full PBIP project folder in the browser
- Upload a zip file if folder upload is not convenient
- Resolve the report folder and semantic model folder from the project structure
- Scan semantic models stored as TMDL
- Build model-to-model dependencies from DAX expressions
- Scan PBIR report JSON for usage in visuals, filters, bookmarks, pages.
- Show supporting evidence for detected references

## Privacy

- Analysis happens in the browser only
- PBIP files are not sent to a backend service
- Semantic model data is not transmitted anywhere as part of the normal analysis flow

## Scope

This app only works with the uploaded PBIP project. It does not try to prove whether an object is used by:

- external reports
- Analyze in Excel
- downstream semantic models
- service-side personal bookmarks
- personalized visuals
- assets that are not present in the uploaded PBIP project

## Known Limitations

- Reports that point only to a remote semantic model by connection cannot be fully analyzed
- The DAX dependency parser is intentionally conservative
- Ambiguous unqualified references are marked as `Unknown`
- This tool is read-only and does not modify or delete PBIP files

## Local Development

```bash
npm install
npm run dev
```

## Contributing

If you want to improve it, feel free to open an issue or a pull request.

## License

Licensed under the MIT License.

See [LICENSE](/C:/Users/davis/Desktop/pbi-reference-explorer/LICENSE).
