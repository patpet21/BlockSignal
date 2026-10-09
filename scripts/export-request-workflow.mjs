import { writeFileSync } from 'node:fs';
import { requestAuditWorkflow } from '../dist/request-audit.js';
writeFileSync(new URL('../docs/request-audit-workflow.json', import.meta.url), JSON.stringify(requestAuditWorkflow(), null, 2) + '\n');
console.log('Inactive request audit workflow exported. No customer data or credentials included.');
