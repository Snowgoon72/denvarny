export const config = {
    api: { bodyParser: { sizeLimit: '4mb' } }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

    const { bildeBase64, erBakside } = req.body;
    if (!bildeBase64) return res.status(400).json({ error: 'Mangler bilde' });

    let aiPrompt = "Du er en ekspert på filmer og tegneserier. Se på dette bildet av en forside. Returner ALLTID et JSON-objekt. Trekk ut 'tittel' (hovedtittel), 'tittel_orig' (originaltittel), 'format' (f.eks Blu-ray, 4K UHD, DVD, Manga, Pocket), og 'pris' (kun tall hvis du ser en cover-pris).";
    
    if (erBakside) {
        aiPrompt = "Dette er et bilde av baksiden av et filmcover eller tegneserie. Returner ALLTID et JSON-objekt. Finn og returner 'alder' (f.eks 15, 18, A), 'tekst' (undertekst-språk som Norsk, Engelsk), 'lyd' (lydspor, f.eks Engelsk 5.1), 'format' (f.eks Blu-ray, DVD, Hardcover hvis det står på baksiden), 'aar' (utgivelsesår eller copyright-år), og eventuelt 'tittel_orig' hvis den er nevnt i liten tekst.";
    }

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: aiPrompt },
                            { type: "image_url", image_url: { url: bildeBase64, detail: "high" } }
                        ]
                    }
                ],
                max_tokens: 150
            })
        });

        const data = await response.json();
        const aiSvar = JSON.parse(data.choices[0].message.content.trim());
        
        res.status(200).json(aiSvar);

    } catch (error) {
        console.error("OpenAI feil:", error);
        res.status(500).json({ error: 'Klarte ikke analysere bildet.' });
    }
}
