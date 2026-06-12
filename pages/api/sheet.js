export default async function handler(req, res) {
  const { id, sheet } = req.query;
  if (!id || !sheet) {
    return res.status(400).json({ error: 'Missing id or sheet param' });
  }
  try {
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Google returned ${r.status}`);
    const text = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
