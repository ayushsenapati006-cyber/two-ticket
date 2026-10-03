import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({apiKey: process.env.OPENAI_API_KEY}) : null;

const GENRE_IDS = {
  Action:28, Adventure:12, Animation:16, Comedy:35, Crime:80, Drama:18,
  Fantasy:14, Horror:27, Mystery:9648, Romance:10749, 'Sci-Fi':878, Thriller:53
};

async function tmdb(pathname, params={}) {
  if(!TMDB_TOKEN) throw new Error('TMDB_ACCESS_TOKEN is missing');
  const url = new URL('https://api.themoviedb.org/3' + pathname);
  for(const [k,v] of Object.entries(params)) if(v!==undefined && v!==null && v!=='') url.searchParams.set(k,String(v));
  const r = await fetch(url, {headers:{accept:'application/json', Authorization:`Bearer ${TMDB_TOKEN}`}});
  if(!r.ok) throw new Error(`TMDB request failed (${r.status})`);
  return r.json();
}

function normalizeMovie(m) {
  return {
    tmdbId:m.id,
    title:m.title,
    year:m.release_date ? Number(m.release_date.slice(0,4)) : 0,
    genres:m.genre_ids?.map(id => Object.entries(GENRE_IDS).find(([,v])=>v===id)?.[0]).filter(Boolean) || [],
    rating:Number(m.vote_average||0),
    runtime:0,
    overview:m.overview||'',
    posterPath:m.poster_path||'',
    popularity:Number(m.popularity||0)
  };
}

async function getDetails(id){
  try {
    return await tmdb(`/movie/${id}`, {language:'en-US', append_to_response:'videos'});
  } catch { return null; }
}

app.post('/api/recommend', async (req,res) => {
  try {
    const genres = Array.isArray(req.body.genres) ? req.body.genres.filter(g=>GENRE_IDS[g]) : [];
    const limit = Math.min(Math.max(Number(req.body.limit)||120,10),120);
    const pageStart = Math.max(1, Number(req.body.pageStart)||1);
    const pageCount = Math.min(Math.max(Number(req.body.pageCount)||5,1),5);
    const exclude = new Set(Array.isArray(req.body.excludeIds) ? req.body.excludeIds.map(String) : []);
    if(!genres.length) return res.status(400).json({error:'Choose at least one genre.'});

    const now = new Date();
    const candidates = new Map();
    let maxTotalPages = 0;

    // Fetch a bounded batch in parallel to avoid slow sequential requests.
    const requests=[];
    for(const genre of genres){
      for(let page=pageStart; page<pageStart+pageCount; page++){
        requests.push(tmdb('/discover/movie', {
          language:'en-US', include_adult:'false', include_video:'false',
          sort_by:'popularity.desc', with_genres:GENRE_IDS[genre], page
        }).then(data=>({page,data})));
      }
    }
    const results=await Promise.allSettled(requests);
    for(const result of results){
      if(result.status!=='fulfilled') continue;
      const {page,data}=result.value;
      maxTotalPages=Math.max(maxTotalPages, Number(data.total_pages||page));
      for(const m of (data.results||[])) if(!exclude.has(String(m.id))) candidates.set(m.id,m);
    }

    // Robust fallback: if a filtered discover request yields no candidates,
    // fetch the general catalog and filter locally by the selected TMDB genre IDs.
    if(candidates.size===0){
      const fallbackPages=[];
      for(let page=pageStart; page<pageStart+pageCount; page++) fallbackPages.push(tmdb('/discover/movie',{
        language:'en-US', include_adult:'false', include_video:'false',
        sort_by:'popularity.desc', page
      }));
      const fallback=await Promise.allSettled(fallbackPages);
      const wanted=new Set(genres.map(g=>GENRE_IDS[g]));
      for(const result of fallback){
        if(result.status!=='fulfilled') continue;
        const data=result.value;
        maxTotalPages=Math.max(maxTotalPages,Number(data.total_pages||0));
        for(const m of (data.results||[])){
          const ids=new Set(m.genre_ids||[]);
          if([...wanted].some(id=>ids.has(id)) && !exclude.has(String(m.id))) candidates.set(m.id,m);
        }
      }
    }

    let movies=[...candidates.values()].map(normalizeMovie)
      .filter(m=>m.title && m.year)
      .sort((a,b)=>b.popularity-a.popularity)
      .slice(0,400);

    // Enrich only a few movies; discover results already contain what the cards need.
    const detailCount=Math.min(8,movies.length);
    const detailed = await Promise.all(movies.slice(0,detailCount).map(async m=>{
      const d=await getDetails(m.tmdbId);
      return d ? {...m,runtime:Number(d.runtime||0)} : m;
    }));
    movies = detailed.concat(movies.slice(detailCount));

    let ranked = movies.map(m=>({...m,reason:'Fresh live movie matching your selected genres.'}));
    if(openai && movies.length){
      const aiPool=movies.slice(0,Math.min(120,movies.length));
      const aiLimit=Math.min(limit,100);
      const compact=aiPool.map((m,i)=>({index:i,title:m.title,year:m.year,genres:m.genres,rating:m.rating,overview:m.overview}));
      const prompt=`You are the recommendation engine for a couples movie swiper.
Selected genres: ${genres.join(', ')}
Today: ${now.toISOString().slice(0,10)}

Rank these real TMDB candidates for the selected genres. Favor strong genre fit, variety, and good audience ratings. Do not invent titles. Return ONLY JSON: {"items":[{"index":0,"reason":"one short sentence"}]} with at most ${aiLimit} items.

Candidates:
${JSON.stringify(compact)}`;
      const response=await openai.responses.create({model:process.env.OPENAI_MODEL||'gpt-5',input:prompt});
      let parsed;
      try { parsed=JSON.parse(response.output_text); } catch {
        const match=response.output_text.match(/\{[\s\S]*\}/); parsed=match?JSON.parse(match[0]):null;
      }
      const items=Array.isArray(parsed?.items)?parsed.items:[];
      const out=[]; const used=new Set();
      for(const item of items){
        const i=Number(item.index); if(!Number.isInteger(i)||!aiPool[i]||used.has(i)) continue;
        used.add(i); out.push({...aiPool[i],reason:String(item.reason||'Good fit for your selected genres.')});
      }
      for(const m of movies){
        if(out.length>=limit) break;
        if(!out.some(x=>x.tmdbId===m.tmdbId)) out.push({...m,reason:'A fresh option that fits your selected genres.'});
      }
      ranked=out.slice(0,limit);
    } else ranked=ranked.slice(0,limit);

    const nextPage=pageStart+pageCount;
    res.json({movies:ranked,source:'TMDB + OpenAI',candidateCount:movies.length,nextPage,hasMore:nextPage<=maxTotalPages});
  } catch(err) {
    console.error(err);
    res.status(500).json({error:err.message || 'Could not load live recommendations.'});
  }
});
app.get('/api/health', (req,res)=>res.json({ok:true,tmdb:!!TMDB_TOKEN,ai:!!openai,supabase:!!(SUPABASE_URL&&SUPABASE_ANON_KEY)}));
app.get('/api/config', (req,res)=>res.json({supabaseUrl:SUPABASE_URL,supabaseAnonKey:SUPABASE_ANON_KEY}));
app.get(/.*/, (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Two Tickets running at http://localhost:${PORT}`));
