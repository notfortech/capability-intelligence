// /api/assessment — Step 3
// Takes tgaResults and traits from /api/pathways response
// Generates assessment questions
// Called by frontend after pathways tab is populated

const { generateAssessmentQuestions } = require('./_helpers');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(404).end('Not found'); return; }

  try {
    const { tgaResults, traits } = req.body;

    const allComps = [
      ...(tgaResults.qualifications || []).slice(0, 2),
      ...(tgaResults.skillSets || []).slice(0, 1),
      ...(tgaResults.units || []).slice(0, 2)
    ].filter(c => c.code);

    const assessmentQuestions = await generateAssessmentQuestions(allComps, traits);

    res.status(200).json({
      success: true,
      assessmentQuestions
    });

  } catch(err) {
    console.error('Assessment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
