import express from "express";
import fetch from 'node-fetch'; // Explicitly import fetch if it's best practice for standalone modules
import { mapBrowserLangToDeeplx, TEXT_DELIMITER } from '../modules/translation-helper.js';

export default function createTranslateRouter() {
    const router = express.Router();

    router.post("/translate", async (req, res) => {
        const { texts, targetBrowserLang } = req.body;

        if (!Array.isArray(texts) || texts.some(t => typeof t !== 'string') || texts.length === 0) {
            return res.status(400).json({ error: "Invalid input: 'texts' must be a non-empty array of strings." });
        }
        if (typeof targetBrowserLang !== 'string' || !targetBrowserLang) {
            return res.status(400).json({ error: "Invalid input: 'targetBrowserLang' must be a non-empty string." });
        }

        const deeplxTargetLang = mapBrowserLangToDeeplx(targetBrowserLang);
        const processedTexts = texts.map(text => String(text).trim());
        const combinedText = processedTexts.join(TEXT_DELIMITER);

        const deeplxPayload = {
            text: combinedText,
            source_lang: "auto",
            target_lang: deeplxTargetLang,
        };

        try {
            console.log(`[Translate API Module] Sending to DeepLX with delimiter "${TEXT_DELIMITER}": ${JSON.stringify(deeplxPayload)}`);
            const deeplxResponse = await fetch("https://deeplx.vercel.app/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(deeplxPayload),
            });

            if (!deeplxResponse.ok) {
                const errorBody = await deeplxResponse.text();
                console.error(`[Translate API Module] DeepLX request failed with status ${deeplxResponse.status}: ${errorBody}`);
                return res.status(deeplxResponse.status).json({ error: "Translation service request failed.", details: errorBody });
            }

            const translationResult = await deeplxResponse.json();
            console.log(`[Translate API Module] Received from DeepLX: ${JSON.stringify(translationResult)}`);

            if (translationResult && typeof translationResult.data === 'string') {
                const receivedData = translationResult.data.trim();
                const translatedTexts = receivedData.split(TEXT_DELIMITER);

                if (translatedTexts.length === processedTexts.length) {
                    console.log(`[Translate API Module] Successfully split translated texts. Count: ${translatedTexts.length}`);
                    return res.json({ translatedTexts });
                } else {
                    console.warn(`[Translate API Module] Mismatch in text count after split with delimiter "${TEXT_DELIMITER}". Original count: ${processedTexts.length}, Translated count: ${translatedTexts.length}.`);
                    const originalTextsForLogging = processedTexts.map((t, i) => `Orig[${i}]: "${t}"`).join(' ; ');
                    console.warn(`[Translate API Module] Original texts sent: ${originalTextsForLogging}`);
                    console.warn(`[Translate API Module] Received combined data from DeepLX (that was split): "${receivedData}"`);
                    translatedTexts.forEach((part, index) => {
                        console.warn(`[Translate API Module] Split part ${index + 1} (length ${part.length}): "${part}"`);
                    });

                    if (processedTexts.length === 1 && translatedTexts.length === 1) {
                        console.log("[Translate API Module] Single text processed, returning single part despite initial length log (this is OK).");
                        return res.json({ translatedTexts });
                    }
                    
                    console.error("[Translate API Module] Critical: Count mismatch for multiple texts. Cannot reliably map translations.");
                    return res.status(500).json({ 
                        error: "Translation service returned data that could not be reliably split into the original number of segments.",
                        details: `Expected ${processedTexts.length} segments, but got ${translatedTexts.length}. Raw response data: "${receivedData}"`
                    });
                }
            } else {
                console.error("[Translate API Module] DeepLX response did not contain a 'data' string, or translationResult was falsy:", translationResult);
                return res.status(500).json({ error: "Translation service returned an unexpected response format (e.g., no 'data' string)." });
            }
        } catch (error) {
            console.error("[Translate API Module] Error during translation proxy:", error);
            return res.status(500).json({ error: "Internal server error during translation." });
        }
    });

    return router;
}