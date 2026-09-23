#!/usr/bin/env node
'use strict';

const policy = require('./model-routing-policy.v1.json');
const { readCatalog } = require('./model-routing-validation.js');

const TIER_RANK = Object.freeze({ economy: 0, balanced: 1, strong: 2 });
const HELP = `Usage:
  node contracts/model-routing.js --host HOST --task TASK [options]
  node contracts/model-routing.js --list --host HOST [--catalog PATH]

Hosts: codebuddy-cli, codebuddy-ide, workbuddy, qoder-cli, qoder-ide,
       trae-ide, trae-work, trae-cli
Tasks: mechanical, implementation, architecture, review, security, visual

Options:
  --risk <low|high>       Task risk classification (default: low)
  --failed-attempts N     Prior failed attempts (default: 0)
  --vision                Require catalog-declared vision capability
  --catalog PATH          Read a caller-declared catalog (max 256 KiB)
  --model ID              Require one explicit model or documented alias
  --allow-switch          Use a model switch explicitly approved in the task plan
  --list                  List documented profiles or supplied catalog metadata
  --help                  Show this help
`;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function requiredTier(input) {
  if (!Object.hasOwn(policy.tasks, input.task)) throw new InputError('unsupported --task');
  const taskTier = policy.tasks[input.task];
  if (input.risk === 'high' || input.failedAttempts > 0) return 'strong';
  return taskTier;
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('input must be an object');
  if (!Object.hasOwn(policy.hosts, input.host)) throw new InputError('unsupported --host');
  const hostPolicy = policy.hosts[input.host];
  const risk = input.risk === undefined ? 'low' : input.risk;
  const failedAttempts = input.failedAttempts === undefined ? 0 : input.failedAttempts;
  if (!['low', 'high'].includes(risk)) throw new InputError('--risk must be low or high');
  if (!Number.isSafeInteger(failedAttempts) || failedAttempts < 0) throw new InputError('--failed-attempts must be a nonnegative integer');
  return Object.freeze({ ...input, risk, failedAttempts, vision: input.vision === true || input.task === 'visual', hostPolicy });
}

function isCapable(model, tier, vision) {
  return model.available
    && TIER_RANK[model.tier] >= TIER_RANK[tier]
    && model.capabilities.includes('tools')
    && model.capabilities.includes('code')
    && (!vision || model.capabilities.includes('vision'));
}

function catalogSelection(input, catalog, tier) {
  if (input.model) {
    const selected = catalog.models.find(({ id }) => id === input.model);
    if (!selected) throw new InputError('explicit model is absent from the catalog');
    if (input.host === 'trae-ide' && selected.origin === 'custom') {
      throw new InputError('explicit model is custom; Trae IDE custom models cannot be bound to subagents');
    }
    if (!isCapable(selected, tier, input.vision)) throw new InputError('explicit model does not meet required tier, availability, or capabilities');
    return { selected, costReason: 'explicit caller choice' };
  }
  const hostEligible = input.host === 'trae-ide'
    ? catalog.models.filter(({ origin, subagentSupported }) => origin === 'builtin' && subagentSupported === true)
    : catalog.models;
  const qualified = hostEligible.filter((candidate) => isCapable(candidate, tier, input.vision));
  if (qualified.length === 0) throw new InputError('catalog has no qualified model; no lower-quality fallback was used');
  const ranked = qualified.every(({ costRank }) => costRank !== undefined);
  let candidates = qualified;
  if (!ranked) {
    const lowestTier = Math.min(...qualified.map(({ tier: candidateTier }) => TIER_RANK[candidateTier]));
    candidates = qualified.filter(({ tier: candidateTier }) => TIER_RANK[candidateTier] === lowestTier);
  }
  const selected = ranked
    ? [...candidates].sort((left, right) => left.costRank - right.costRank || TIER_RANK[left.tier] - TIER_RANK[right.tier])[0]
    : candidates[0];
  return {
    selected,
    costReason: ranked
      ? 'lowest caller-declared relative cost rank among all qualified models'
      : 'deterministic catalog order because at least one candidate cost rank is unknown',
  };
}

function dispatchFor(host, hostPolicy, selected, fromCatalog) {
  if (hostPolicy.dispatch === 'manual-only') return Object.freeze({ kind: 'manual-only', value: null });
  if (hostPolicy.dispatch === 'trae-builtin-agent-frontmatter') {
    return fromCatalog && selected && selected.origin === 'builtin' && selected.subagentSupported === true
      ? Object.freeze({ kind: 'agent-frontmatter', value: selected.id })
      : Object.freeze({ kind: 'manual-only', value: null });
  }
  if (!selected) return Object.freeze({ kind: 'manual-only', value: null });
  return Object.freeze({ kind: hostPolicy.dispatch, value: selected ? selected.id : null });
}

function selectModel(rawInput) {
  const input = validateInput(rawInput);
  const tier = requiredTier(input);
  const recommendedProfile = input.hostPolicy.profiles[tier];
  if (input.allowSwitch !== true) {
    if (input.model) throw new InputError('--model requires a planned model switch (--allow-switch)');
    if (input.catalogPath) readCatalog(input.catalogPath, input.host);
    return Object.freeze({
      selectionScope: 'recommendation',
      nativeExecution: 'not-observed',
      availability: 'unobserved',
      chosenModel: null,
      tier,
      recommendedProfile,
      reason: `${tier} is recommended; the plan did not enable switching, so subagents inherit the current model`,
      dispatch: Object.freeze({ kind: 'inherit', value: null }),
    });
  }
  if (input.catalogPath) {
    const catalog = readCatalog(input.catalogPath, input.host);
    const { selected, costReason } = catalogSelection(input, catalog, tier);
    return Object.freeze({
      selectionScope: 'recommendation',
      nativeExecution: 'not-observed',
      availability: 'caller-declared',
      chosenModel: selected.id,
      tier,
      recommendedProfile,
      reason: `${tier} is required; selected ${costReason}; costRank is relative caller-declared metadata, not a USD price`,
      dispatch: dispatchFor(input.host, input.hostPolicy, selected, true),
    });
  }
  if (input.model) {
    if (!input.hostPolicy.aliasesBindable) throw new InputError('explicit --model requires a catalog for this host');
    const aliasTier = Object.keys(input.hostPolicy.profiles).find((candidateTier) => input.hostPolicy.profiles[candidateTier] === input.model);
    if (!aliasTier) throw new InputError('explicit model is not a documented alias for this host');
    if (TIER_RANK[aliasTier] < TIER_RANK[tier]) throw new InputError('explicit model alias does not meet required tier');
  }
  const chosenModel = input.hostPolicy.aliasesBindable ? (input.model || recommendedProfile) : null;
  const selected = chosenModel ? { id: chosenModel, origin: 'builtin' } : null;
  const visionReason = input.vision ? '; vision capability remains unverified without a catalog' : '';
  const profileReason = input.hostPolicy.aliasesBindable
    ? `${recommendedProfile} is a documented host alias and actual availability is unobserved`
    : `${recommendedProfile} is an advisory task profile; no native model binding is established`;
  return Object.freeze({
    selectionScope: 'recommendation',
    nativeExecution: 'not-observed',
    availability: 'unobserved',
    chosenModel,
    tier,
    recommendedProfile,
    reason: `${tier} is required; ${profileReason}${visionReason}`,
    dispatch: dispatchFor(input.host, input.hostPolicy, selected, false),
  });
}

function listModels(rawInput) {
  const input = validateInput({ ...rawInput, task: rawInput.task || 'mechanical' });
  if (input.catalogPath) {
    const catalog = readCatalog(input.catalogPath, input.host);
    return Object.freeze({
      listScope: 'caller-declared-catalog',
      nativeExecution: 'not-observed',
      availability: 'caller-declared',
      host: input.host,
      models: catalog.models,
    });
  }
  return Object.freeze({
    listScope: 'documented-aliases',
    nativeExecution: 'not-observed',
    availability: 'unobserved',
    host: input.host,
    profiles: input.hostPolicy.profiles,
    binding: input.hostPolicy.aliasesBindable ? 'documented-host-alias' : 'advisory-only',
  });
}

function parseArguments(argv) {
  const input = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--help', '--list', '--vision', '--allow-switch', '--host', '--task', '--risk', '--failed-attempts', '--catalog', '--model'].includes(flag)) {
      throw new InputError('unknown argument');
    }
    if (seen.has(flag)) throw new InputError('duplicate argument');
    seen.add(flag);
    if (['--help', '--list', '--vision', '--allow-switch'].includes(flag)) {
      input[flag === '--allow-switch' ? 'allowSwitch' : flag.slice(2)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new InputError(`${flag} requires a value`);
    index += 1;
    const key = { '--host': 'host', '--task': 'task', '--risk': 'risk', '--failed-attempts': 'failedAttempts', '--catalog': 'catalogPath', '--model': 'model' }[flag];
    input[key] = flag === '--failed-attempts' && /^\d+$/.test(value) ? Number(value) : value;
  }
  return input;
}

function main(argv = process.argv.slice(2)) {
  try {
    const input = parseArguments(argv);
    if (input.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (!input.host) throw new InputError('--host is required');
    if (!input.list && !input.task) throw new InputError('--task is required unless --list is used');
    const result = input.list ? listModels(input) : selectModel(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unexpected failure';
    process.stderr.write(`model-routing: ${message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { InputError, listModels, main, parseArguments, selectModel };
