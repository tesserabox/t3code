const fs = require("node:fs");
const path = require("node:path");

const serverAsar = process.argv[2];
if (!serverAsar) {
  throw new Error("Usage: package-probe.cjs <server.asar>");
}

const packageNames = [
  "@github/copilot-sdk",
  "@github/copilot",
  "@github/copilot-win32-x64",
  "koffi",
];

const versions = Object.fromEntries(
  packageNames.map((packageName) => {
    const packageJsonPath = path.join(serverAsar, "node_modules", packageName, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return [packageName, packageJson.version];
  }),
);

process.stdout.write(`${JSON.stringify(versions)}\n`);
