import { parseArgs } from "util";
import { mirror } from "./mirror";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    baseUrl: {
      type: "string",
    },
    update: {
      type: "boolean",
      default: true,
    },
    force: {
      type: "boolean",
    },
    "dry-run": {
      type: "boolean",
    },
    concurrency: {
      type: "string",
      default: "4",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  allowPositionals: true,
});

function printUsage() {
  console.error("Usage: podmirror <rssUrl> <outputDir> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --baseUrl <url>      The public URL where the mirror will be hosted");
  console.error("  --force              Re-fetch even if local copies exist");
  console.error("  --dry-run            Report planned actions without writing");
  console.error("  --concurrency <N>    Control parallel downloads (default: 4)");
  console.error("  -h, --help           Show this help message");
}

if (values.help || positionals.length < 2) {
  printUsage();
  if (positionals.length < 2 && !values.help) {
    console.error("");
    console.error("Error: Missing required arguments");
    process.exit(1);
  }
  process.exit(0);
}

const [rssUrl, outputDir] = positionals;

try {
  await mirror({
    rssUrl,
    outputDir,
    baseUrl: values.baseUrl,
    force: values.force,
    dryRun: values["dry-run"],
    concurrency: parseInt(values.concurrency || "4", 10),
  });
  console.log("Done!");
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
