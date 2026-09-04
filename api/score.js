// /api/score — Vercel serverless function
// Exact same logic as server.js POST /api/score

const { scoreAssessment } = require('./_helpers');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(404).end('Not found'); return; }

  try {
    const { questions, responses, competencies, name } = req.body;
    const result = await scoreAssessment(questions, responses, competencies, name);
    res.status(200).json({ success: true, result });
  } catch(err) {
    console.error('Score error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
