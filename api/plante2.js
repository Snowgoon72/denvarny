export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

  try {
    const { sokeord } = req.body;
    const apiKey = process.env.PERENUAL_API_KEY; 

    if (!apiKey) return res.status(500).json({ error: 'Mangler PERENUAL_API_KEY' });

    const response = await fetch(`https://perenual.com/api/species-list?key=${apiKey}&q=${encodeURIComponent(sokeord)}`);
    const data = await response.json();
    
    if (!response.ok) return res.status(response.status).json({ error: "Feil fra Perenual" });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Serverfeil ved data-søk' });
  }
}
