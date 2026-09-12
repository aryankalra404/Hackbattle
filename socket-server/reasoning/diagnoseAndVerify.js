const { reasonAboutCircuit, toCircuitResult } = require('./openaiCircuitReasoner');
const { retrieve } = require('../rag/retrieve');
const { verifyDiagnosis } = require('./verifyDiagnosis');

function report(onStage, stage, details) {
  if (onStage) onStage(stage, details);
}

function buildRetrievalQuery(fault) {
  return `${fault.componentId}: ${fault.issue}`;
}

function aggregateConfidence(verifications) {
  if (verifications.some((verification) => verification.verdict === 'uncertain')) return 'uncertain';
  if (verifications.some((verification) => verification.verdict === 'corrected')) return 'corrected';
  return 'confirmed';
}

/**
 * Runs the complete fault-only grounding pipeline. Throws only if the core
 * reasoning call itself fails, so server.js can fall back to the
 * deterministic rules — a real diagnosis from a real model is always better
 * than the crude rule engine. A failure in grounding/verification (RAG index
 * missing, a schema slip, a timeout) no longer throws the diagnosis away: it
 * degrades to reporting it unverified instead of discarding it for rules.
 */
async function diagnoseAndVerify(circuit, options = {}) {
  const reason = options.reasonAboutCircuit || reasonAboutCircuit;
  const retrieveChunks = options.retrieve || retrieve;
  const verify = options.verifyDiagnosis || verifyDiagnosis;
  const onStage = options.onStage;
  const intent = typeof options.intent === 'string' ? options.intent.trim() : '';

  const diagnosis = await reason(circuit, intent);
  report(onStage, 'reasoning:received', diagnosis);
  if (!diagnosis.hasFault) {
    return {
      result: {
        ...toCircuitResult(diagnosis),
        confidence: null,
        groundedOn: null,
        suspectedComponent: null,
        suspectedComponents: [],
        faults: []
      },
      diagnosis,
      chunks: [],
      verification: null
    };
  }

  try {
    const retrievals = await Promise.all(diagnosis.faults.map(async (fault) => {
      const query = buildRetrievalQuery(fault);
      report(onStage, 'rag:query', { componentId: fault.componentId, query });
      const chunks = await retrieveChunks(query, 2);
      report(onStage, 'rag:retrieved', {
        componentId: fault.componentId,
        chunks: chunks.map(({ source, heading, score }) => ({ source, heading, score }))
      });
      return { fault, chunks };
    }));

    report(onStage, 'verification:sent', { diagnosis, faultCount: retrievals.length });
    const verification = await verify(diagnosis, retrievals);
    report(onStage, 'verification:received', verification);

    const verifiedFaults = verification.verifications.map((verified) => {
      const fault = diagnosis.faults.find((candidate) => candidate.componentId === verified.componentId);
      return { ...fault, ...verified };
    });
    const groundedOn = [...new Set(verifiedFaults.map((fault) => fault.groundedOn))].join('; ');
    const message = verifiedFaults.map((fault) => fault.finalMessage).join(' ');

    // An uncertain result still needs student attention, so it remains a false
    // `ok` result but the verifier's message makes its uncertainty explicit.
    return {
      result: {
        ok: false,
        message,
        confidence: aggregateConfidence(verifiedFaults),
        groundedOn,
        // Legacy singular field remains the first component for old clients.
        suspectedComponent: diagnosis.suspectedComponent || null,
        suspectedComponents: diagnosis.suspectedComponents,
        faults: verifiedFaults
      },
      diagnosis,
      chunks: retrievals.flatMap((retrieval) => retrieval.chunks),
      retrievals,
      verification
    };
  } catch (error) {
    report(onStage, 'verification:failed', { message: error.message });
    console.warn(`[diagnose] grounding/verification failed, reporting the diagnosis unverified: ${error.message}`);
    return {
      result: {
        ok: false,
        message: diagnosis.faults.map((fault) => fault.issue).join(' '),
        confidence: 'uncertain',
        groundedOn: null,
        suspectedComponent: diagnosis.suspectedComponent || null,
        suspectedComponents: diagnosis.suspectedComponents,
        faults: diagnosis.faults.map((fault) => ({
          ...fault,
          verdict: 'uncertain',
          finalMessage: fault.issue,
          groundedOn: null
        }))
      },
      diagnosis,
      chunks: [],
      verification: null
    };
  }
}

module.exports = { diagnoseAndVerify, buildRetrievalQuery, aggregateConfidence };
