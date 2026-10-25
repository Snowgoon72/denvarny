export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

  try {
    // Nå kan den ta imot enten sokeord ELLER en id
    const { sokeord, id } = req.body;
    const apiKey = process.env.PERENUAL_API_KEY; 

    if (!apiKey) return res.status(500).json({ error: 'Mangler PERENUAL_API_KEY' });

    let url = "";
    if (id) {
        // Hvis appen ber om en ID, henter vi det fullstendige detaljkortet
        url = `https://perenual.com/api/species/details/${id}?key=${apiKey}`;
    } else {
        // Hvis appen ber om sokeord, søker vi i listen
        url = `https://perenual.com/api/species-list?key=${apiKey}&q=${encodeURIComponent(sokeord)}`;
    }

    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) return res.status(response.status).json({ error: "Feil fra Perenual" });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Serverfeil ved data-søk' });
  }
}
