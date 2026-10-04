import test from 'node:test';
import { queueScenario } from '../qa/service-queue.mjs';

test('HTTP project queue preserves run isolation, cursor freshness and durable saved receipts', () => queueScenario(process.env.B3_EVIDENCE_DIR));
