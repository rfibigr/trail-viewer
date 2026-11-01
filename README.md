# Trail Viewer

View a trail run's elevation profile coloured by **vertical speed**: climbs in warm colours, descents in cool colours, with darker shades for faster ascent or descent.

![Trail Viewer](docs/screenshots/demo-viewer-desktop-light.png)

Load a `.fit` file exported from Garmin Connect, or try the built-in demo activity. Everything runs in your browser; nothing is uploaded.

## Features
- Elevation profile coloured by vertical speed (m/h), using either section averages or a finer rolling value
- Automatic climb / descent / flat detection, with a threshold so small bumps don't break a climb up
- Timer pauses and stationary stops (aid stations) are removed from moving time and vertical speeds
- X axis in distance or moving time
- Summary (distance, D+/D−, average climb and descent speed), and a sortable table of sections linked to the chart
- Adjustable analysis settings (smoothing, segment threshold, flat grade, speed window)
- Light and dark mode, works on phones

## Getting a FIT file from Garmin Connect
Open the activity → ⚙️ (top right) → **Export File** (the original FIT file, inside a `.zip`). Unzip it and drop the `.fit` file on the app.

## Development
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
```

## Architecture
```
src/types/     shared data contracts
src/fit/       FIT bytes -> Activity        (@garmin/fitsdk; demo activity generator)
src/analysis/  Activity -> AnalysisResult   (pauses, smoothing, vertical speed, segmentation)
src/ui/        React + ECharts viewer
```
