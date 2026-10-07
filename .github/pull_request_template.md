## What and why

<!-- What does this change, and what problem does it solve? Link the issue: "Closes #123". -->

## How it was tested

- [ ] `npm run check` passes
- [ ] Tried it in a browser (`npm run build:demo` and open `dist-demo/` works without a Karakeep instance)
- [ ] Screenshots below for any visible change (light and dark, desktop and mobile if relevant)

## Checklist

- [ ] No new network requests on the path to first paint
- [ ] Interpolated HTML goes through `esc()`; no inline handlers/styles (CSP)
- [ ] `SCHEMA_VERSION` bumped if the cached snapshot shape changed
- [ ] README updated if behaviour or configuration changed
