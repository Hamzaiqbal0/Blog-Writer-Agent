from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import json
import requests
import litellm # Import litellm
import re # For regular expressions to parse paragraphs

# --- Environment Variable Loading ---
# Load environment variables from .env file
load_dotenv()

# Pexels API Key
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")

# Set keys for LiteLLM. It will automatically detect these environment variables.
os.environ["OPENROUTER_API_KEY"] = os.getenv("OPENROUTER_API_KEY")


# --- FastAPI App Initialization ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your frontend's domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic model for the request body
class BlogRequest(BaseModel):
    prompt: str

# --- Pexels Image Fetching (Modified to return single image URL) ---
def fetch_single_image(query: str) -> str | None:
    """
    Fetches a single image URL from the Pexels API based on a given query.
    Returns the URL of a 'large' or 'medium' size image, or None if not found/error.
    """
    if not PEXELS_API_KEY:
        print("PEXELS_API_KEY not found. Skipping image fetch.")
        return None
    headers = {"Authorization": PEXELS_API_KEY}
    # Fetch 1 image, prioritize landscape for blog layout
    params = {"query": query, "per_page": 1, "orientation": "landscape"} 
    try:
        res = requests.get("https://api.pexels.com/v1/search", headers=headers, params=params, timeout=5)
        res.raise_for_status() # Raise an exception for HTTP errors
        data = res.json()
        if data.get('photos'):
            # Prefer 'large' for higher quality, fallback to 'medium'
            return data['photos'][0]['src'].get('large') or data['photos'][0]['src'].get('medium')
        else:
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching image from Pexels for query '{query}': {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred in fetch_single_image: {e}")
        return None

# --- Streaming Blog Generator Endpoint (Updated with LiteLLM and Image Embedding) ---
@app.post("/generate")
async def generate(request: BlogRequest):
    """
    Generates a blog post in a streaming fashion using LiteLLM,
    then fetches relevant images from Pexels and embeds them directly into the Markdown.
    """
    user_prompt = request.prompt
    if not user_prompt:
        return JSONResponse({"error": "No prompt provided"}, status_code=400)

    # System message for the AI model: now focused purely on blog content and structure.
    # We are NOT asking for JSON keywords from the AI anymore.
    system_msg = {
        "role": "system",
        "content": (
            "You are a creative blog writer. Write a comprehensive, engaging, and well-structured blog post based on the given topic. "
            "Include an introduction, several main body paragraphs, and a conclusion. "
            "Use catchy headings (`##`), markdown for **bold** and *italic*, short paragraphs, and bullet points. "
            "Use emojis 🎯 to make it more engaging. Focus on clear, concise writing."
        )
    }
    conversation = [system_msg, {"role": "user", "content": user_prompt}]

    async def stream_generator():
        full_blog_text = ""
        image_keywords = [] # To store keywords for image fetching

        print("🤖 Requesting blog content via LiteLLM...")
        try:
            response_stream = await litellm.acompletion(
                model="openrouter/google/gemini-2.0-flash-exp:free", # Primary choice
                messages=conversation,
                stream=True,
                fallbacks=[ # Add your desired fallbacks here
                    {"model": "gemini/gemini-2.0-flash-exp"},
                    {"model": "claude-3-5-sonnet-20240620"}
                ]
            )

            # Process the stream from LiteLLM for the blog text
            async for chunk in response_stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    full_blog_text += token
                    yield token # Yield initial text chunks
            
            # --- After full blog text is received, generate image keywords and embed images ---
            print("\n🔍 Generating image keywords from blog content...")
            # Use another LiteLLM call to get structured keywords based on the generated text
            keyword_generation_prompt = {
                "role": "user",
                "content": f"Extract 3-5 concise, general keywords related to the main theme of the following blog post for image search. Provide them as a JSON array, e.g., '{{\"keywords\": [\"keyword1\", \"keyword2\"]}}'.\n\nBlog Post:\n{full_blog_text[:1000]}" # Send a snippet to save tokens
            }

            try:
                keyword_response = await litellm.acompletion(
                    model="openrouter/google/gemini-2.0-flash-exp:free", # Or any other suitable model
                    messages=[
    {"role": "system", "content": "You are a helpful assistant that extracts keywords as a JSON array."},
    keyword_generation_prompt
],
                    response_model={"keywords": list[str]}, # Use response_model for structured output
                    stream=False # Do not stream keyword response
                )
                image_keywords = keyword_response.choices[0].message.content.get("keywords", [])
                print(f"🖼️ Extracted keywords: {image_keywords}")

            except Exception as e:
                print(f"Error generating image keywords: {e}")
                # Fallback to using the initial prompt if keyword extraction fails
                image_keywords = user_prompt.split()[:3] # Simple split for fallback
                print(f"Using fallback keywords: {image_keywords}")

            # --- Fetch and embed images ---
            if image_keywords:
                # Decide how many images to embed and where.
                # For simplicity, let's fetch one image per keyword up to 3 images,
                # and try to insert them after roughly every 3 paragraphs.
                
                # Split the blog content into paragraphs
                paragraphs = re.split(r'\n\s*\n', full_blog_text) # Split by one or more blank lines
                embedded_blog_parts = []
                image_count = 0
                max_images_to_insert = 2 # Limit the number of images to insert for demonstration

                for i, paragraph in enumerate(paragraphs):
                    embedded_blog_parts.append(paragraph)

                    if image_count < max_images_to_insert and (i + 1) % 3 == 0 and image_keywords and len(image_keywords) > image_count:
                        keyword_for_image = image_keywords[image_count]
                        image_url = fetch_single_image(keyword_for_image)
                        if image_url:
                            # Yield the Markdown for the image
                            image_markdown = f'\n\n![{keyword_for_image.replace("_", " ").title()}]({image_url})\n\n'
                            embedded_blog_parts.append(image_markdown)
                            image_count += 1
                        else:
                            print(f"Failed to fetch image for '{keyword_for_image}'.")
                
                # If images were appended, they are now part of embedded_blog_parts.
                # Join and yield the final content.
                final_content_with_images = "\n\n".join(embedded_blog_parts)
                # Yield any remaining content that includes the embedded images
                # This will re-yield some content, but ensures images are sent after text
                yield final_content_with_images[len(full_blog_text):] # Yield only the new image markdown added
                
                print("✅ Images embedded into blog content.")
            else:
                print("❌ No keywords to fetch images or Pexels API key missing.")


        except Exception as e:
            # This will catch errors if all fallback models fail or during image processing
            print(f"Error in stream_generator: {e}")
            error_message = f'\n**Error:** An issue occurred during blog or image generation. Details: {str(e)}'
            yield error_message
            return

    # Return the StreamingResponse with the async generator
    return StreamingResponse(stream_generator(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    # Make sure to set your PEXELS_API_KEY and OPENROUTER_API_KEY (or GEMINI_API_KEY)
    # in your .env file or as environment variables.
    uvicorn.run(app, host="0.0.0.0", port=8000)