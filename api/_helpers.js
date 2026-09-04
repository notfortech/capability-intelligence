// Shared helpers — no logic changes from server.js

const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    }).on('error', reject);
  });
}

// Token cache — note: in serverless each cold start is fresh
// Vercel keeps functions warm between calls so this still helps
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const CLIENT_ID = process.env.PROKERALA_CLIENT_ID;
  const CLIENT_SECRET = process.env.PROKERALA_CLIENT_SECRET;
  const body = `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
  const res = await httpsPost('api.prokerala.com', '/token', {
    'Content-Type': 'application/x-www-form-urlencoded'
  }, body);
  if (res.body.access_token) {
    cachedToken = res.body.access_token;
    tokenExpiry = Date.now() + (res.body.expires_in - 60) * 1000;
    return cachedToken;
  }
  throw new Error('Token fetch failed: ' + JSON.stringify(res.body));
}

async function callProkerala(endpoint, params) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  return httpsGet('api.prokerala.com', `/v2/${endpoint}?${qs}`, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  });
}

async function searchTGA(query) {
  try {
    const res = await httpsGet(
      'training.gov.au',
      `/api/v1/training-component/search?q=${encodeURIComponent(query)}&includeSuperseded=false&pageSize=5`,
      { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    );
    if (res.body && res.body.data) {
      return res.body.data.slice(0, 4).map(q => ({
        code: q.code,
        title: q.title,
        type: q.typeName || q.type,
        status: q.status,
        url: `https://training.gov.au/Training/Details/${q.code}`
      }));
    }
    return [];
  } catch(e) { return []; }
}

async function callClaude(messages, maxTokens = 2000) {
  const res = await httpsPost('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  }, {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages
  });
  return res.body;
}

async function getChartReading(name, planetData, kundliData, dashaData) {
  const res = await callClaude([{
    role: 'user',
    content: `You are an expert Vedic astrologer using the South Indian tradition.

Person: ${name || 'the native'}
Planet positions: ${JSON.stringify(planetData, null, 2)}
Kundli: ${JSON.stringify(kundliData, null, 2)}
Dasha: ${dashaData ? JSON.stringify(dashaData, null, 2) : 'Not available'}

IMPORTANT: Write the full complete reading. Do not truncate or summarise. Every section must be complete.

Provide a full Vedic career reading covering:
1. LAGNA AND PERSONALITY
2. CAREER NATURE — industries, work environment, contribution style
3. CURRENT PERIOD — mahadasha and antardasha themes
4. CAREER CHALLENGES
5. KEY STRENGTHS

After your reading, output EXACTLY this block with no variations to the delimiters:

---SKILLS_TRAITS---
1. [specific professional skill or trait from chart]
2. [specific professional skill or trait from chart]
3. [specific professional skill or trait from chart]
4. [specific professional skill or trait from chart]
5. [specific professional skill or trait from chart]
6. [specific professional skill or trait from chart]
7. [specific professional skill or trait from chart]
8. [specific professional skill or trait from chart]
---END_TRAITS---

Rules for the traits list:
- Exactly 8 items, numbered 1-8
- Each must be a specific vocational skill — not a personality trait
- Ground each one in the actual planetary positions
- Example of good: "Ability to translate complex data into clear visual reports for non-technical audiences"
- Example of bad: "Good communicator" or "Hardworking"`
  }], 4000);
  return res.content?.[0]?.text || '';
}

async function extractSearchTerms(traitsText) {
  const res = await callClaude([{
    role: 'user',
    content: `From these professional traits, generate search terms for training.gov.au.
Return ONLY valid JSON, no markdown:
{
  "qualifications": ["3-4 Australian qualification titles"],
  "skillSets": ["2-3 skill set names"],
  "units": ["4-5 unit of competency descriptions"],
  "industryCodes": ["2-3 TGA package codes like BSB CHC ICT HLT TAE"]
}

Traits:
${traitsText}`
  }], 500);

  const text = res.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { qualifications: ['Certificate IV Business Administration'], skillSets: ['Digital Literacy Skill Set'], units: ['Manage personal development'], industryCodes: ['BSB'] };
  }
}

async function fetchTGAResults(searchTerms) {
  const results = { qualifications: [], skillSets: [], units: [] };
  const delay = ms => new Promise(r => setTimeout(r, ms));

  for (const t of (searchTerms.qualifications || []).slice(0, 3)) {
    results.qualifications.push(...await searchTGA(t));
    await delay(250);
  }
  for (const t of (searchTerms.skillSets || []).slice(0, 2)) {
    results.skillSets.push(...await searchTGA(t));
    await delay(250);
  }
  for (const t of (searchTerms.units || []).slice(0, 3)) {
    results.units.push(...await searchTGA(t));
    await delay(250);
  }

  const dedupe = arr => {
    const seen = new Set();
    return arr.filter(i => i.code && !seen.has(i.code) && seen.add(i.code));
  };

  results.qualifications = dedupe(results.qualifications).slice(0, 6);
  results.skillSets = dedupe(results.skillSets).slice(0, 4);
  results.units = dedupe(results.units).slice(0, 6);
  return results;
}

async function generatePathways(name, reading, traits, tgaResults) {
  const fmt = arr => arr.length
    ? arr.map(q => `  ${q.code}: ${q.title} (${q.type})`).join('\n')
    : '  [Search training.gov.au directly]';

  const res = await callClaude([{
    role: 'user',
    content: `You are a Vedic astrologer who understands the Australian VET system.

Person: ${name || 'the native'}
Chart reading summary: ${reading.substring(0, 600)}
Chart traits: ${traits}

Australian qualifications from training.gov.au:
QUALIFICATIONS:\n${fmt(tgaResults.qualifications)}
SKILL SETS:\n${fmt(tgaResults.skillSets)}
UNITS:\n${fmt(tgaResults.units)}

Provide:
1. COMPETENCY MAPPING — map each chart trait to a specific Australian unit or competency (use codes where available)
2. RECOMMENDED QUALIFICATION — one clear first step with code, duration, typical roles in Melbourne
3. SKILL SETS FOR QUICK ENTRY — which skill sets allow fast workforce entry
4. RPL OPPORTUNITIES — what prior experience likely counts toward recognition
5. NEXT STEP — one specific action this week on training.gov.au

Be specific, warm, and practical.`
  }], 2500);
  return res.content?.[0]?.text || '';
}

async function generateAssessmentQuestions(competencies, traits) {
  const res = await callClaude([{
    role: 'user',
    content: `You are designing a skills self-assessment for someone exploring these Australian vocational competencies:

${JSON.stringify(competencies, null, 2)}

Their chart-identified professional traits are:
${traits}

Generate a self-assessment with EXACTLY this JSON structure — no markdown, valid JSON only:
{
  "clusters": [
    {
      "id": "cluster_1",
      "title": "Short cluster name (3-5 words)",
      "competencyCode": "e.g. BSB40120",
      "competencyTitle": "Full qualification or unit title",
      "description": "One sentence describing what this cluster assesses",
      "questions": [
        {
          "id": "q1",
          "text": "Specific practical question about this skill area",
          "ratingLabels": ["Never done this", "Done this once or twice", "Do this sometimes", "Do this regularly", "This is a core strength"],
          "evidencePrompt": "Briefly describe a specific time you did this (or why you haven't)"
        }
      ]
    }
  ]
}

Rules:
- Create exactly 2 clusters — each covering a distinct competency area
- Each cluster has exactly 4 questions — no more, no fewer
- Questions must be practical and specific — not abstract
- Questions must reflect real workplace tasks from the competency
- evidencePrompt must be different for each question
- The total assessment must take 8-10 minutes
- CRITICAL: Output complete valid JSON only. Do not truncate. Close all brackets and braces properly.`
  }], 3500);

  const text = res.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('Assessment parse error:', text.substring(0, 200));
    return { clusters: [] };
  }
}

async function scoreAssessment(questions, responses, competencies, name) {
  const responseList = questions.clusters.map(cluster => ({
    cluster: cluster.title,
    competency: cluster.competencyCode + ' ' + cluster.competencyTitle,
    answers: cluster.questions.map(q => {
      const r = responses[q.id] || {};
      return {
        question: q.text,
        rating: r.rating || 0,
        ratingLabel: q.ratingLabels?.[r.rating] || 'Not answered',
        evidence: r.evidence || ''
      };
    })
  }));

  const res = await callClaude([{
    role: 'user',
    content: `You are an Australian VET assessor reviewing a skills self-assessment.

Person: ${name || 'the person'}
Competencies assessed: ${competencies.map(c => c.code + ' ' + c.title).join(', ')}

Self-assessment responses:
${JSON.stringify(responseList, null, 2)}

Provide an evidence-based readiness assessment in this EXACT JSON format — no markdown:
{
  "overallReadiness": "percentage 0-100",
  "overallLevel": "Beginner|Developing|Competent|Advanced",
  "summary": "2-3 sentence honest summary of readiness",
  "clusters": [
    {
      "title": "cluster title",
      "competencyCode": "code",
      "readinessScore": 0-100,
      "readinessLevel": "Beginner|Developing|Competent|Advanced",
      "rplLikelihood": "Low|Medium|High",
      "strengths": ["specific strength from their evidence"],
      "gaps": ["specific gap identified from their responses"],
      "recommendation": "Specific next step for this cluster"
    }
  ],
  "rplRecommendation": "Overall RPL advice — what to document and submit",
  "studyRecommendation": "Specific qualification and entry point recommended based on their evidence",
  "priorityActions": [
    "Specific action 1 — grounded in their actual responses",
    "Specific action 2",
    "Specific action 3"
  ]
}

Be honest — do not inflate scores. Low evidence means low score. Specific concrete evidence means higher score. Weight the evidence text heavily.`
  }], 2000);

  const text = res.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { overallReadiness: '0', overallLevel: 'Error', summary: 'Could not parse assessment.', clusters: [] };
  }
}

module.exports = {
  callProkerala, searchTGA, callClaude,
  getChartReading, extractSearchTerms, fetchTGAResults,
  generatePathways, generateAssessmentQuestions, scoreAssessment
};
