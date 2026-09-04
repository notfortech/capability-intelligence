// /api/pathways — Step 2
// Takes traits from /api/chart response
// Runs: traits → search terms → TGA → Claude pathways
// Called by frontend after chart reading is displayed

const {
  extractSearchTerms, fetchTGAResults, generatePathways
} = require('./_helpers');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(404).end('Not found'); return; }

  try {
    const { traits, reading, name } = req.body;

    const searchTerms = await extractSearchTerms(traits || reading.substring(0, 600));
    const tgaResults = await fetchTGAResults(searchTerms);
    const pathwaysReading = await generatePathways(name, reading, traits, tgaResults);

    res.status(200).json({
      success: true,
      searchTerms,
      tgaResults,
      pathways: pathwaysReading
    });

  } catch(err) {
    console.error('Pathways error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
