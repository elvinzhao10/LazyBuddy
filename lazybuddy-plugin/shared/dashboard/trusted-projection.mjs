import { completionApplies } from './adapters/completion.mjs';
import { compatiblePlanRevision } from './commands.mjs';
import { createProjector } from './projection.mjs';

export const projectSnapshot = createProjector({ completionApplies, compatiblePlanRevision });
