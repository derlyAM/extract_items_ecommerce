import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

// Initialize OpenAI client with your API key
const openai = new OpenAI({
  apiKey: '',
});

async function main() {
  // Determine which HTML file to read: pass filename as CLI arg or use the first .html found
  const RESPONSE_DIR = "response_HTML";
  const DATA_DIR = "data";

  // Ensure the data dir exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // HTML file and card class must be passed as CLI arguments
  const inputFile  = process.argv[2]; // HTML file
  const cardClass  = process.argv[3]; // nombre de la clase p.ej. product-card

  if (!inputFile || !cardClass) {
    console.error("⚠️  Uso: node process_html.js <archivo.html> <nombre_clase_card>");
    process.exit(1);
  }

  const htmlPath = path.join(RESPONSE_DIR, inputFile);
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  // Parse HTML and seleccionar elementos por clase
  const dom   = new JSDOM(htmlContent);
  const cards = Array.from(dom.window.document.querySelectorAll(`.${cardClass}`))
                     .map(el => el.outerHTML);

  if (cards.length === 0) {
    console.error(`⚠️  No se encontró ningún elemento con la clase '${cardClass}'`);
    process.exit(1);
  }

  const results = [];

  for (const card of cards) {
    const prompt = `
      I have the following HTML block for a product card:
      ${card}

      Extract:
      - ID
      - Title
      - Price
      - Image (url)
      - Description

      Return only the JSON object.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that extracts structured data."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    console.log("Response:", response.choices[0].message.content);

    try {
      let content = response.choices[0].message.content.trim();

      if (content.startsWith("```json")) {
        content = content.slice(7).trim();
      }
      if (content.endsWith("```")) {
        content = content.slice(0, -3).trim();
      }

      const json = JSON.parse(content);
      results.push(json);
    } catch (err) {
      console.error("Failed to parse JSON:", err);
    }
  }

  // Save results as JSON array
  const outName = path.join(DATA_DIR, path.parse(inputFile).name + ".json");
  fs.writeFileSync(outName, JSON.stringify(results, null, 2));
  console.log(`✅ JSON generado → ${outName}`);
}

main();