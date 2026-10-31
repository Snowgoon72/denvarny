export const config = {
    api: { bodyParser: { sizeLimit: '4mb' } }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

    const { bildeBase64 } = req.body;
    if (!bildeBase64) return res.status(400).json({ error: 'Mangler bilde' });

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" }, // 1. Tvinger AI-en til å svare med gyldig JSON
                messages: [
                    {
                        role: "user",
                        content: [
                            { 
                                type: "text", 
                                // 2. Her er den nye instruksen din lagt inn:
                                text: "Du er en ekspert på filmer og tegneserier. Se på dette bildet og finn tittelen. Returner alltid JSON med en 'tittel'. Hvis du tydelig kan lese en cover-pris på bladet (f.eks NOK, Kr eller $), legg den ved som et rent tall i et felt kalt 'pris'." 
                            },
                            { 
                                type: "image_url", 
                                image_url: { url: bildeBase64, detail: "low" } 
                            }
                        ]
                    }
                ],
                max_tokens: 50
            })
        });

        const data = await response.json();
        
        // 3. Gjør om JSON-teksten fra AI-en til et faktisk objekt, og sender det til appen
        const aiSvar = JSON.parse(data.choices[0].message.content.trim());
        res.status(200).json(aiSvar);

    } catch (error) {
        console.error("OpenAI feil:", error);
        res.status(500).json({ error: 'Klarte ikke analysere bildet.' });
    }
}
