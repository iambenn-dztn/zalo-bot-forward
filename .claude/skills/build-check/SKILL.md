---
name: build-check
description: Build the Electron app for Windows and verify the output
disable-model-invocation: true
---

# Build Check

Run the Electron build process and verify the output.

## Steps

1. Verify all source files referenced in `package.json` `build.files` array exist
2. Run `npm run build:win` to build the Windows installer
3. Check the `dist/` directory for the generated `.exe` installer
4. Report:
   - Build success or failure
   - Output file names and sizes
   - Any warnings or errors from electron-builder
