const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

const USDA_KEY   = process.env.USDA_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;

// ===== CORS =====
const allowedOrigins = [
  'https://jikoni.netlify.app',
  'https://angels-kitchen.netlify.app',
  'https://angelskitchen.netlify.app',
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

// ===== USDA NUTRITION LOOKUP =====
app.get('/api/nutrition', async (req, res) => {
  const { ingredient } = req.query;
  if (!ingredient) return res.status(400).json({ error: 'ingredient is required' });

  try {
    // Search ALL data types for best coverage — Foundation, SR Legacy, Survey (FNDDS)
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(ingredient)}&pageSize=10&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&api_key=${USDA_KEY}`;
    const response = await fetch(url);
    const data     = await response.json();

    if (!data.foods?.length) {
      return res.json({ found: false });
    }

    // Score each result for relevance
    const query = ingredient.toLowerCase().trim();
    const scored = data.foods.map(food => {
      const name     = (food.description || '').toLowerCase();
      let score      = food.foodNutrients?.length || 0; // more nutrients = better

      // Exact match bonus
      if (name === query) score += 1000;
      // Starts with query bonus
      if (name.startsWith(query)) score += 500;
      // Contains query bonus
      if (name.includes(query)) score += 200;
      // Prefer shorter names (less specific = more generic = more accurate)
      score -= name.length * 0.5;
      // Prefer Foundation & SR Legacy over Survey
      if (food.dataType === 'Foundation')  score += 300;
      if (food.dataType === 'SR Legacy')   score += 200;

      return { food, score };
    });

    // Sort by score and pick best
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].food;

    // Map nutrient IDs to keys
    const nutrientMap = {
      1008: 'calories', 1062: 'calories', 2047: 'calories', 2048: 'calories',
      1003: 'protein',  1005: 'carbs',    1004: 'fat',
      1079: 'fiber',    1093: 'sodium',   1063: 'sugar',
      1162: 'vitaminC', 1087: 'calcium',  1089: 'iron',     1092: 'potassium',
    };

    const nutrients = {};
    (best.foodNutrients || []).forEach(n => {
      const key = nutrientMap[n.nutrientId];
      if (key && (n.value || 0) > 0) {
        if (!nutrients[key] || n.value > nutrients[key]) {
          nutrients[key] = n.value;
        }
      }
    });

    // Verify we got meaningful data — at least calories
    if (!nutrients.calories) {
      return res.json({ found: false });
    }

    res.json({ found: true, name: best.description, nutrients });

  } catch (err) {
    console.error('USDA error:', err);
    res.status(500).json({ error: 'USDA lookup failed' });
  }
});

// ===== CLAUDE AI NUTRITION ESTIMATE =====
app.post('/api/estimate', async (req, res) => {
  const { ingredient, grams } = req.body;
  if (!ingredient) return res.status(400).json({ error: 'ingredient is required' });

  // Quick blocklist — common non-food words in English and Swahili
  const nonFoodWords = [
    'stone','rock','wood','metal','plastic','glass','sand','soil','dirt','paper',
    'iron','steel','concrete','brick','leather','rubber','cloth','fabric',
    'jiwe','mawe','mti','chuma','mchanga','udongo','karatasi','kioo','nguo',
    'plastiki','mpira','saruji','matofali','ngozi','mafuta ya taa','mafuta ya gari'
  ];
  const clean_ing = ingredient.toLowerCase().trim();
  if (nonFoodWords.includes(clean_ing)) {
    return res.json({ found: false, unknown: true });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role:    'user',
          content: `You are a strict food ingredient validator and nutrition expert.

The user entered: "${ingredient}" (${grams || 100}g)

YOUR JOB: Decide if "${ingredient}" is something a human would actually EAT or DRINK.

Mark as unknown=true if ANY of these apply:
- Not a food, drink, spice, herb, or cooking ingredient
- Gibberish or random letters (e.g. xyzabc, asdfgh, jjjj)
- A non-food physical object in ANY language — e.g. "stone/jiwe", "rock/mawe", "wood/mti", "iron/chuma", "sand/mchanga", "plastic", "glass/kioo", "paper/karatasi"
- A place, person name, or abstract concept
- A Swahili, English, or other language word for something inedible
- You are not at least 80% confident it is eaten as food

Mark as unknown=false ONLY if you are confident it is a real edible ingredient.

Return ONLY raw JSON, no markdown, no backticks:
If edible: {"unknown":false,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sodium":0,"sugar":0,"vitaminC":0,"calcium":0,"iron":0,"potassium":0}}
If NOT edible: {"unknown":true,"nutrients":null}

Scale all nutrient values to ${grams || 100}g if it is real food.`
        }]
      })
    });

    const data  = await response.json();
    const raw   = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (result.unknown) {
      return res.json({ found: false, unknown: true });
    }

    res.json({ found: true, source: 'ai', nutrients: result.nutrients });

  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: 'AI estimate failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Angel's Kitchen API running on port ${PORT}`);
});
