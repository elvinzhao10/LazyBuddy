import test from 'node:test';
import { authorityScenario, serviceScenario } from '../qa/service-evidence.mjs';

test('authority rejects synthetic protected artifacts and permits legitimate evidence', () => authorityScenario(process.env.B3_EVIDENCE_DIR));
test('HTTP marks existing protected references unavailable and preserves legitimate archives', () => serviceScenario(process.env.B3_EVIDENCE_DIR));
