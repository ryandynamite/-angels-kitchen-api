const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ===== CORS =====
const allowedOrigins = [
  'https://jikoni.netlify.app',
  'https://angels-kitchen.netlify.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: "Angel's Kitchen API is running" });
});

// ===== GEMINI NUTRITION ANALYSIS =====
// Handles everything: food validation + nutrition in one call
app.post('/api/analyse', async (req, res) => {
  const { ingredient, grams } = req.body;
  if (!ingredient) return res.status(400).json({ error: 'ingredient is required' });

  const amount = parseFloat(grams) || 100;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const prompt = `You are a professional nutritionist with knowledge of foods from all countries and languages including Swahili, English, Arabic, and others.

The user entered the food ingredient: "${ingredient}" (${amount}g)

STEP 1 - Identify if this is a real edible food:
Real foods include: all meats (beef, chicken, pork, lamb, fish, eggs, nyama, kuku, samaki), grains (rice, ugali, chapati, wali, unga, mtama), vegetables (tomato, onion, spinach, sukuma wiki, karoti, kabichi), fruits (banana, ndizi, mango, embe, avocado), dairy (milk, maziwa, cheese, butter), legumes (beans, maharage, lentils, dengu), spices and oils.

NOT food: stones (jiwe, mawe), wood (mti), metal (chuma), sand (mchanga), paper (karatasi), glass (kioo), plastic, random letters (xyzabc), non-food objects in any language.

STEP 2 - If real food, provide accurate nutrition for exactly ${amount}g.

Return ONLY a raw JSON object. No markdown. No explanation. No backticks.

If it IS real food:
{"isFood":true,"name":"standardized food name in English","nutrients":{"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"sodium":number,"sugar":number,"vitaminC":number,"calcium":number,"iron":number,"potassium":number}}

If it is NOT food:
{"isFood":false,"name":"${ingredient}","nutrients":null}

All nutrient values must be realistic numbers for ${amount}g. Calories for common foods are typically between 20-900 kcal per 100g.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
      })
    });

    const data   = await response.json();
    const raw    = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (!result.isFood) {
      return res.json({ found: false, unknown: true, name: result.name });
    }

    res.json({
      found:    true,
      source:   'gemini',
      name:     result.name,
      nutrients: result.nutrients
    });

  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Keep old endpoints for backward compatibility
app.get('/api/nutrition', (req, res) => res.json({ found: false }));
app.post('/api/estimate', (req, res) => res.json({ found: false, unknown: true }));

app.listen(PORT, () => {
  console.log(`Angel's Kitchen API running on port ${PORT}`);
});
