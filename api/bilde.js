export const config = {
    api: { bodyParser: { sizeLimit: '4mb' } }
};

// Forside: tittel slik den står på coveret (= "Cover tittel" i appen), format, utgave og type.
const PROMPT_FORSIDE = `Du er en ekspert på filmer, TV-serier og tegneserier. Se på dette bildet av en FORSIDE.
Returner ALLTID et JSON-objekt med disse feltene:
- "tittel": hovedtittelen NØYAKTIG slik den står på coveret (ikke oversett, ikke rett på den).
- "tittel_orig": originaltittel hvis den står på coveret, ellers "".
- "aar": utgivelsesår hvis det står tydelig på coveret, ellers "".
- "format": f.eks. "Blu-ray", "4K UHD", "DVD", "3D", "Manga", "Pocket", "Hardcover". Står både 4K og Blu-ray på en kombipakke, svar "4K UHD".
- "utgave": KUN hvis coveret tydelig sier en spesiell utgave, f.eks. "Director's Cut", "Extended Edition", "Theatrical Cut", "Unrated", "Special Edition", "Collector's Edition", "Limited Edition", "Steelbook", "Anniversary Edition", "Remastered", "Criterion Collection". Ellers "".
- "mediatype": "Serie" hvis det står Season, Sesong, Series, Complete Series, Miniserie e.l., ellers "Film".
- "pris": kun tall hvis du ser en cover-pris, ellers "".
VIKTIG: Ikke gjett. Står noe ikke tydelig på bildet, svar "".`;

// Bakside: tekniske spesifikasjoner (bildeformat, alle språk), alder og utgave.
const PROMPT_BAKSIDE = `Dette er et bilde av BAKSIDEN av et filmcover, en TV-serie eller en tegneserie.
Returner ALLTID et JSON-objekt med disse feltene:
- "alder": aldersgrense, f.eks. "15", "18", "A", ellers "".
- "tekst": en LISTE med ALLE undertekstspråk som står oppført, f.eks. ["Norsk","Svensk","Dansk","Finsk"]. Tom liste [] hvis ingen.
- "lyd": en LISTE med ALLE lydspor inkludert lydformat, f.eks. ["Engelsk DTS-HD MA 5.1","Norsk Dolby Digital 2.0"]. Tom liste [] hvis ingen.
- "bildeformat": skjermformatet NØYAKTIG slik det er trykt, f.eks. "2.35:1", "1.85:1", "16:9 Anamorphic Widescreen", "4:3". Ikke forveksle med lydformat (5.1, 7.1) eller oppløsning (1080p, 2160p). Står det ikke tydelig, svar "".
- "utgave": KUN hvis baksiden tydelig sier en spesiell utgave (Director's Cut, Extended Edition, Unrated, Steelbook o.l.). Ellers "".
- "format": f.eks. "Blu-ray", "4K UHD", "DVD", "Hardcover" hvis det står på baksiden, ellers "".
- "mediatype": "Serie" hvis det står episoder, sesong, season e.l., ellers "Film".
- "tittel_orig": originaltittel hvis den er nevnt, ellers "".
VIKTIG: Ikke gjett. Ta bare med det som faktisk står på bildet.`;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST er tillatt' });

    const { bildeBase64, erBakside } = req.body;
    if (!bildeBase64) return res.status(400).json({ error: 'Mangler bilde' });

    const aiPrompt = erBakside ? PROMPT_BAKSIDE : PROMPT_FORSIDE;

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
                temperature: 0,          // mindre gjetting
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: aiPrompt },
                            { type: "image_url", image_url: { url: bildeBase64, detail: "high" } }
                        ]
                    }
                ],
                max_tokens: 600          // var 150 – for lite til lange språklister (svaret ble kuttet)
            })
        });

        const data = await response.json();
        if (!response.ok || !data.choices) {
            console.error("OpenAI feil:", data);
            return res.status(502).json({ error: (data.error && data.error.message) || 'Feil fra OpenAI' });
        }

        let aiSvar;
        try {
            aiSvar = JSON.parse(data.choices[0].message.content.trim());
        } catch (e) {
            console.error("Klarte ikke tolke AI-svar:", data.choices[0].message.content);
            return res.status(502).json({ error: 'AI-svaret var ikke gyldig JSON.' });
        }

        res.status(200).json(aiSvar);

    } catch (error) {
        console.error("OpenAI feil:", error);
        res.status(500).json({ error: 'Klarte ikke analysere bildet.' });
    }
}
