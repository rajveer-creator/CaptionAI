/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("child_process");

// On Windows (especially when synced via OneDrive), files in .next can be marked Read-Only,
// causing Next.js build cleanup to fail with EPERM. On Linux/macOS, this is a no-op.
if (process.platform === "win32") {
  try {
    execSync("attrib -r .next\\* /s /d", { stdio: "ignore" });
  } catch {
    // .next directory may not exist yet on fresh clone
  }
}
