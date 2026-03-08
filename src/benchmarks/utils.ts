import fs from "fs/promises";
import path from "path";
import os from "os";

const BENCHMARKS_FILE = path.join(import.meta.dirname, "../../BENCHMARKS.md");

const HEADER = `# Benchmarks

## Running

\`\`\`bash
bun run bench          # run all benchmarks
bun run bench:add      # add-jobs throughput only
bun run bench:acquire  # acquire-job latency only
\`\`\`

Requires Postgres running (\`bun run docker:up\`).

`;

export interface SystemInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryGb: number;
  nodeVersion: string;
  bunVersion: string;
  pollocksVersion: string;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus();
  const pkg = JSON.parse(
    await fs.readFile(
      path.join(import.meta.dirname, "../../package.json"),
      "utf-8",
    ),
  );

  let bunVersion = "unknown";
  try {
    const proc = Bun.spawnSync(["bun", "--version"]);
    bunVersion = proc.stdout.toString().trim();
  } catch {}

  return {
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCores: cpus.length,
    memoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    nodeVersion: process.version,
    bunVersion,
    pollocksVersion: pkg.version,
  };
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export async function appendResults(
  benchmarkId: string,
  sysInfo: SystemInfo,
  buildTable: (lines: string[]) => void,
): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(BENCHMARKS_FILE, "utf-8");
  } catch {}

  // Ensure the file starts with the header
  if (!existing.includes("## Running")) {
    existing = HEADER;
  }

  // Build the new section
  const sectionLines: string[] = [];
  const timestamp = new Date().toISOString().split("T")[0];

  sectionLines.push(`## ${benchmarkId} (${timestamp})`);
  sectionLines.push("");
  sectionLines.push(`- **Pollocks version**: ${sysInfo.pollocksVersion}`);
  sectionLines.push(`- **Runtime**: Bun ${sysInfo.bunVersion}`);
  sectionLines.push(`- **CPU**: ${sysInfo.cpuModel} (${sysInfo.cpuCores} cores)`);
  sectionLines.push(`- **Memory**: ${sysInfo.memoryGb}GB`);
  sectionLines.push(`- **OS**: ${sysInfo.platform} (${sysInfo.arch})`);

  buildTable(sectionLines);

  sectionLines.push("");

  const sectionContent = sectionLines.join("\n");

  // Replace existing section (match by benchmarkId, ignoring date) or append
  const sectionRegex = new RegExp(
    `## ${benchmarkId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\([^)]+\\)[\\s\\S]*?(?=\\n## |$)`,
  );

  if (sectionRegex.test(existing)) {
    existing = existing.replace(sectionRegex, sectionContent);
  } else {
    existing = existing.trimEnd() + "\n\n" + sectionContent + "\n";
  }

  await fs.writeFile(BENCHMARKS_FILE, existing);
}
