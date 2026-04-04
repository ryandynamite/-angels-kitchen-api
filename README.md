# Angel's Kitchen API

Backend server that safely proxies API calls to USDA FoodData Central and Claude AI.
Your API keys live here — never in the browser.

## Environment Variables (set these in Railway)

| Variable | Value |
|----------|-------|
| `USDA_API_KEY` | sHy6XqZKr7eGTId0uLyY6y8RAUpwpIJ7IPpCcItc |
| `CLAUDE_API_KEY` | your Claude API key from console.anthropic.com |

## Endpoints

- `GET /` — health check
- `GET /api/nutrition?ingredient=rice` — USDA lookup
- `POST /api/estimate` — Claude AI estimate (body: `{ ingredient, grams }`)

## Deploy to Railway

1. Push this folder to a GitHub repository
2. Connect the repo to Railway
3. Add the environment variables above
4. Railway auto-deploys on every push
