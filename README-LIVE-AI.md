# Two Tickets — Live AI Movie Recommendations

This version keeps the original Two Tickets swipe/match experience but adds live recommendations.

## What changed
- TMDB supplies current movie titles, release dates, ratings, posters and overviews.
- OpenAI ranks the live TMDB candidates against the selected genres and writes a short reason for each recommendation.
- The original embedded movie list remains as an offline fallback if the live API is unavailable.
- API keys stay on the server; they are NOT placed in the HTML.
- Two-device rooms share the live movie objects so both users swipe the same movies.

## Run locally
1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Put your TMDB access token and OpenAI API key in `.env`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

TMDB attribution is required by TMDB's terms for API data/images. Add the TMDB logo/required attribution to the production UI before public deployment.


### Expanded live pool
This version fetches up to 20 TMDB pages per selected genre, keeps up to 500 candidates, ranks up to 120 with AI, and can return up to 150 swipeable movies.
