// /api/chart — Step 1 only
// Prokerala → planets, kundli, dasha → Claude reading + traits
// Returns quickly (~15-20s). Frontend calls /api/pathways next.

const { callProkerala, getChartReading } = require('./_helpers');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(404).end('Not found'); return; }

  try {
    const { dob, tob, lat, lon, tz, name } = req.body;

    const datetime = `${dob}T${tob}:00${tz}`;
    const latVal = parseFloat(lat);
    const lonVal = parseFloat(lon);
    const params = {
      datetime,
      coordinates: `${latVal.toFixed(2)},${lonVal.toFixed(2)}`,
      ayanamsa: 1
    };

    // Fetch Prokerala data in parallel
    const [planets, kundli] = await Promise.all([
      callProkerala('astrology/planet-position', params),
      callProkerala('astrology/kundli', params)
    ]);
    let dasha = { body: null };
    try { dasha = await callProkerala('astrology/vimshottari-dasha', params); } catch(e) {}

    // Claude reading + traits extraction
    const fullReading = await getChartReading(name, planets.body, kundli.body, dasha.body);

    // Robust traits extraction
    let astrologyReading = fullReading;
    let traitsRaw = '';

    const delimiters = [
      ['---SKILLS_TRAITS---', '---END_TRAITS---'],
      ['SKILLS_TRAITS', 'END_TRAITS'],
      ['**SKILLS AND TRAITS**', '**END**'],
    ];
    for (const [start, end] of delimiters) {
      const si = fullReading.indexOf(start);
      if (si !== -1) {
        astrologyReading = fullReading.substring(0, si).trim();
        const afterStart = fullReading.substring(si + start.length);
        const ei = afterStart.indexOf(end);
        traitsRaw = ei !== -1 ? afterStart.substring(0, ei).trim() : afterStart.trim();
        break;
      }
    }

    // Fallback traits extraction
    if (!traitsRaw) {
      const { callClaude } = require('./_helpers');
      const traitsRes = await callClaude([{
        role: 'user',
        content: `From this Vedic astrology career reading, extract exactly 8 specific professional skills and traits as a numbered list. Be specific and vocational. Format each as: "1. [skill]"\n\n${astrologyReading.substring(0, 1200)}`
      }], 800);
      traitsRaw = traitsRes.content?.[0]?.text || '';
    }

    res.status(200).json({
      success: true,
      planets: planets.body,
      kundli: kundli.body,
      dasha: dasha.body,
      reading: astrologyReading,
      traits: traitsRaw
    });

  } catch(err) {
    console.error('Chart error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
