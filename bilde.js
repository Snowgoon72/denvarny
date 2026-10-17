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
                messages: [
                    {
                        role: "user",
                        content: [
                            { 
                                type: "text", 
                                text: "Du er en ekspert på filmer. Se på dette bildet av et filmcover eller en filmplakat. Hva er tittelen på filmen? Svar KUN med den offisielle filmtittelen, ingenting annet. Ikke ta med ord som Blu-ray, DVD, anmeldelser eller skuespillere. Hvis du ser et tydelig utgivelsesår, kan du legge det til i parentes bak tittelen, men prioriter navnet." 
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
        const tittel = data.choices[0].message.content.trim();
        
        res.status(200).json({ tittel });

    } catch (error) {
        console.error("OpenAI feil:", error);
        res.status(500).json({ error: 'Klarte ikke analysere bildet.' });
    }
}