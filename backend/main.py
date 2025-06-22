from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
import os, json, requests

# Load environment variables
load_dotenv()
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Initialize app
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter client
client = OpenAI(api_key=OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")

# Request model
class BlogRequest(BaseModel):
    prompt: str

# Image fetcher
def fetch_images(query: str, count: int = 3):
    headers = {"Authorization": PEXELS_API_KEY}
    params = {"query": query, "per_page": count}
    try:
        res = requests.get("https://api.pexels.com/v1/search", headers=headers, params=params)
        data = res.json()
        return [p['src']['medium'] for p in data.get('photos', [])]
    except:
        return []

# Streaming blog generator
@app.post("/generate")
async def generate(request: BlogRequest):
    prompt = request.prompt
    if not prompt:
        return JSONResponse({"error": "No prompt provided"}, status_code=400)

    system_msg = {
        "role": "system",
        "content": (
            "You are a creative blog writer.\n"
            "Use catchy headings (`##`), markdown (**bold**, *italic*, etc.),\n"
            "short paragraphs, bullet points, emojis 🎯, and end with:\n"
            '{"images": ["ai education"]}'
        )
    }
    conversation = [system_msg, {"role": "user", "content": prompt}]

    def stream_generator():
        full_text = ""
        try:
            stream = client.chat.completions.create(
                model="deepseek/deepseek-r1-0528:free",
                messages=conversation,
                stream=True
            )
            for chunk in stream:
                token = chunk.choices[0].delta.content  # ✅ Fixed from .get("content")
                if token:
                    full_text += token
                    yield token

            # Extract image keywords
            start = full_text.rfind('{"images":')
            if start != -1:
                json_block = full_text[start:].split("\n")[0]
                keywords = json.loads(json_block).get("images", [])
                image_urls = []
                for kw in keywords:
                    image_urls.extend(fetch_images(kw, count=1))
                yield f'\n<!--IMAGE_JSON_START-->{json.dumps(image_urls)}<!--IMAGE_JSON_END-->'

        except Exception as e:
            yield f"\n**Error:** {str(e)}"

    return StreamingResponse(stream_generator(), media_type="text/plain")
