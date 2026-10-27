import { assertRegistrableArtifactPath } from './paths.mjs';

// Research records are bookkeeping. A saved note documents a question, its sources,
// findings, uncertainty and a recommendation; it grants no verification, accepts no
// requirement, and a finding reaches project content ONLY through a proposal link.

export function researchSourcePaths(finding) {
  const paths = []; const rejected = [];
  if (finding === null || typeof finding !== 'object') return { paths, rejected };
  for (const source of Array.isArray(finding.sources) ? finding.sources : []) {
    if (typeof source !== 'string' || !source.length) continue;
    try {
      assertRegistrableArtifactPath(source, 'research.source');
      paths.push(source);
    } catch {
      rejected.push(source);
    }
  }
  return { paths, rejected };
}

export function composeResearchFindings(request) {
  const { command_id, project_id, expected_revision, findings } = request ?? {};
  if (typeof command_id !== 'string' || !command_id.length ||
      typeof project_id !== 'string' || !project_id.length ||
      !Number.isSafeInteger(expected_revision) || expected_revision < 0) {
    throw Object.assign(new Error('INVALID_RESEARCH_REQUEST'), { code: 'INVALID_RESEARCH_REQUEST' });
  }
  if (!Array.isArray(findings) || !findings.length) {
    throw Object.assign(new Error('EMPTY_CHANGE'), { code: 'EMPTY_CHANGE' });
  }
  return { schema_version: 1, command_id, project_id, expected_revision,
    operation: 'record_research_findings', payload: { findings } };
}

export function researchPromotionView(snapshot) {
  const proposals = new Map((snapshot?.proposals ?? []).map(proposal => [proposal.id, proposal]));
  return (snapshot?.research ?? []).map(finding => {
    const proposal = finding.promotion_proposal_id != null ? proposals.get(finding.promotion_proposal_id) : undefined;
    if (finding.promotion_proposal_id != null && !proposal) {
      throw Object.assign(new Error('UNKNOWN_PROPOSAL'), { code: 'UNKNOWN_PROPOSAL' });
    }
    const status = proposal ? (proposal.state === 'accepted' ? 'linked_accepted' : 'linked_proposed') : 'unlinked';
    return {
      id: finding.id, question: finding.question, sources: finding.sources,
      captured_at: finding.captured_at, uncertainty: finding.uncertainty ?? null,
      recommendation: finding.recommendation ?? null,
      promotion: {
        proposal_id: finding.promotion_proposal_id ?? null,
        proposal_state: proposal?.state ?? null,
        status,
        grants_verification: false,
        accepts_requirement: false,
        promotion_path: 'proposal_only',
      },
    };
  });
}

// Fail-closed authority assertion: research records must never carry acceptance or
// verification meaning, now or through future schema drift.
export function assertResearchGrantsNothing(snapshot) {
  const findings = snapshot?.research ?? [];
  for (const finding of findings) {
    for (const key of Object.keys(finding ?? {})) {
      if (/^(accepted|verified|verification|requirement|state|status|authority|proof)/i.test(key)) {
        throw Object.assign(new Error(`RESEARCH_AUTHORITY_LEAK: ${key}`), { code: 'RESEARCH_AUTHORITY_LEAK' });
      }
    }
  }
  return {
    research_count: findings.length,
    grants_verification: false,
    accepts_requirement: false,
    accepted_requirement_ids: (snapshot?.items ?? [])
      .filter(item => item.kind === 'requirement' && item.state === 'accepted').map(item => item.id),
  };
}
