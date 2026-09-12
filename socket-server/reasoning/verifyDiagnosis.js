const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 8000);
const verificationSchema = {
  name: 'grounded_circuit_verification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      verifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            componentId: { type: 'string' },
            verdict: { type: 'string', enum: ['confirmed', 'corrected', 'uncertain'] },
            finalMessage: { type: 'string' },
            groundedOn: { type: 'string' }
          },
          required: ['componentId', 'verdict', 'finalMessage', 'groundedOn']
        }
      }
    },
    required: ['verifications']
  }
};

const systemPrompt = `You are CircuitDoctor's verification step. Check the proposed circuit-fault diagnosis only against the supplied datasheet excerpts.

Return exactly one verification for every proposed fault. Return confirmed when the excerpt clearly supports that diagnosis. Return corrected only when the excerpt contradicts the diagnosis; finalMessage must state the corrected understanding. Do not use corrected merely to reword, add detail to, or clarify an already-supported diagnosis. Return uncertain when the excerpts do not clearly support or refute it; finalMessage must say it is unconfirmed and advise a double-check. Do not invent electrical facts, component specs, or source citations.

groundedOn must identify the supplied source filename and section heading that most directly supports your verdict. Keep finalMessage concise, plain English, and grounded in that excerpt.`;

function validateVerification(value, expectedComponentIds) {
  if (!value || !Array.isArray(value.verifications)) throw new Error('OpenAI returned an invalid verification shape.');
  const receivedIds = new Set();
  for (const verification of value.verifications) {
    if (!verification || !expectedComponentIds.includes(verification.componentId) || receivedIds.has(verification.componentId)) {
      throw new Error('OpenAI returned an invalid verification component.');
    }
    if (!['confirmed', 'corrected', 'uncertain'].includes(verification.verdict)) {
      throw new Error('OpenAI returned an invalid verification verdict.');
    }
    for (const key of ['finalMessage', 'groundedOn']) {
      if (typeof verification[key] !== 'string' || !verification[key].trim()) {
        throw new Error(`OpenAI returned an invalid verification ${key}.`);
      }
    }
    receivedIds.add(verification.componentId);
  }
  if (receivedIds.size !== expectedComponentIds.length) throw new Error('OpenAI did not verify every proposed fault.');
  return value;
}

async function verifyDiagnosis(diagnosis, retrievals) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  if (!Array.isArray(retrievals) || retrievals.length === 0) throw new Error('At least one retrieved datasheet chunk is required.');

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const proposedFaults = retrievals.map(({ fault, chunks }) => ({
    componentId: fault.componentId,
    issue: fault.issue,
    evidence: chunks.map(({ source, heading, text }) => ({ source, heading, text }))
  }));
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_schema', json_schema: verificationSchema },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Reasoning trace:\n${diagnosis.reasoning}\n\nProposed faults and their datasheet excerpts:\n${JSON.stringify(proposedFaults)}`
      }
    ]
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no verification content.');
  return validateVerification(JSON.parse(content), proposedFaults.map((fault) => fault.componentId));
}

module.exports = { verifyDiagnosis, validateVerification };
