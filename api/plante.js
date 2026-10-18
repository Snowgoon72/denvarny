export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

  try {
    const { bildeBase64 } = req.body;
    const apiKey = process.env.PLANTNET_API_KEY; 

    if (!apiKey) return res.status(500).json({ error: 'Mangler PLANTNET_API_KEY' });

    const base64Data = bildeBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    
    const formData = new FormData();
    formData.append('images', blob, 'plante.jpg');
    formData.append('organs', 'auto');

    const response = await fetch(`https://my-api.plantnet.org/v2/identify/all?api-key=${apiKey}`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || "Feil fra Pl@ntNet" });
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Serverfeil ved bildeanalyse' });
  }
}
