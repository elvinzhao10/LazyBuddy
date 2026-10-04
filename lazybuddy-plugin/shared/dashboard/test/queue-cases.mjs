import * as scenarios from './queue-scenarios.mjs';
import * as adversarial from './queue-adversarial.mjs';

const stages = ['after-stage:1', 'after-stage', 'after-journal', 'after-commit', 'after-install:1'];
const faults = ['after-intent', 'after-run', ...['intent', 'run', 'confirmation'].flatMap(scope => stages.map(stage => `${scope}/${stage}`))];
export const cases = [
  ...['competing', 'activate', 'rejected', 'collision', 'readiness', 'boundaries'].map(name => [name, f => scenarios[name](f)]),
  ...faults.map(fault => [`crash-${fault.replaceAll('/', '-').replaceAll(':', '-')}`, f => scenarios.interrupted(f, fault)]),
  ...stages.map(stage => [`command-${stage.replaceAll(':', '-')}`, f => adversarial.commandFault(f, stage)]),
  ...['tampered-intent', 'orphan', 'run-link'].map(variant => [variant, f => adversarial.corrupt(f, variant)]),
  ...['fifo', 'lock', 'bounds', 'journalTamper', 'routes', 'repeated', 'prerequisites'].map(name => [name, f => adversarial[name](f)]),
];
