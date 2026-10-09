import fs from 'node:fs/promises';
import { buildAutomationWorkflows } from '../automation/workflows.mjs';
const names = { watch: '01-property-watch', collector: '02-hpd-collector', notifier: '03-internal-notices', errors: '04-execution-errors', health: '05-health-report' };
for (const [key, workflow] of Object.entries(buildAutomationWorkflows())) {
  await fs.writeFile(new URL(`../automation/${names[key]}.json`, import.meta.url), JSON.stringify(workflow, null, 2) + '\n');
}
console.log('Five inactive workflows exported. No instance connected or messages sent.');
