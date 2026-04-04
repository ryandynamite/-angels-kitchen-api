const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ===== API KEYS (stored safely on server, never exposed to browser) =====
const USDA_KEY   = process.env.USDA_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;

// ===== CORS — only allow requests from your Netlify app =====
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
  res.json({ status: 'Angel\'s Kitchen API is running' });
});

// ===== USDA NUTRITION LOOKUP =====
// GET /api/nutrition?ingredient=rice
app.get('/api/nutrition', async (req, res) => {
  const { ingredient } = req.query;
  if (!ingredient) return res.status(400).json({ error: 'ingredient is required' });

  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(ingredient)}&pageSize=5&dataType=Foundation,SR%20Legacy&api_key=${USDA_KEY}`;
    const response = await fetch(url);
    const data     = await response.json();

    if (!data.foods?.length) {
      return res.json({ found: false });
    }

    // Pick food with most nutrient data
    const food = data.foods.reduce((best, current) =>
      (current.foodNutrients?.length || 0) > (best.foodNutrients?.length || 0) ? current : best
    );

    // Map nutrients
    const nutrientMap = {
      1008: 'calories', 1062: 'calories', 2047: 'calories', 2048: 'calories',
      1003: 'protein',  1005: 'carbs',    1004: 'fat',
      1079: 'fiber',    1093: 'sodium',   1063: 'sugar',
      1162: 'vitaminC', 1087: 'calcium',  1089: 'iron', 1092: 'potassium',
    };

    const nutrients = {};
    (food.foodNutrients || []).forEach(n => {
      const key = nutrientMap[n.nutrientId];
      if (key && (n.value || 0) > 0) {
        if (!nutrients[key] || n.value > nutrients[key]) {
          nutrients[key] = n.value;
        }
      }
    });

    res.json({ found: true, name: food.description, nutrients });
  } catch (err) {
    console.error('USDA error:', err);
    res.status(500).json({ error: 'USDA lookup failed' });
  }
});

// ===== CLAUDE AI NUTRITION ESTIMATE =====
// POST /api/estimate
// Body: { ingredient: "ugali", grams: 400 }
app.post('/api/estimate', async (req, res) => {
  const { ingredient, grams } = req.body;
  if (!ingredient) return res.status(400).json({ error: 'ingredient is required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            CLAUDE_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role:    'user',
          content: `Estimate the nutritional content of ${grams || 100}g of "${ingredient}".
Return ONLY raw JSON, no markdown, no explanation:
{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sodium":0,"sugar":0,"vitaminC":0,"calcium":0,"iron":0,"potassium":0}`
        }]
      })
    });

    const data  = await response.json();
    const raw   = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const nutrients = JSON.parse(clean);

    res.json({ found: true, source: 'ai', nutrients });
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: 'AI estimate failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Angel's Kitchen API running on port ${PORT}`);
});
