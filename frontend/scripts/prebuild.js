/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("child_process");

// On Windows (especially when synced via OneDrive), files in .next can be marked Read-Only
// or locked by OneDrive sync. On Linux/macOS (Vercel/Render/etc.), this is a no-op.
if (process.platform === "win32") {
  try {
    execSync("attrib -r -s -h /s /d .next\\*", { stdio: "ignore" });
  } catch {
    // .next directory may not exist yet on fresh clone
  }
}
