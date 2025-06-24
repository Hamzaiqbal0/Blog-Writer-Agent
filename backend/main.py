from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os, json, requests

# Load environment variables from .env file
load_dotenv()
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY") # Use a more specific name for clarity

# Initialize FastAPI app
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Consider restricting this in production for security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic model for the request body
class BlogRequest(BaseModel):
    prompt: str

# Function to fetch images from Pexels API
def fetch_images(query: str, count: int = 3):
    """
    Fetches image URLs from the Pexels API based on a given query.
    """
    headers = {"Authorization": PEXELS_API_KEY}
    params = {"query": query, "per_page": count}
    try:
        res = requests.get("https://api.pexels.com/v1/search", headers=headers, params=params)
        res.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
        data = res.json()
        # Extract medium-sized image URLs
        return [p['src']['medium'] for p in data.get('photos', [])]
    except requests.exceptions.RequestException as e:
        print(f"Error fetching images from Pexels: {e}")
        return []
    except json.JSONDecodeError:
        print(f"Error decoding JSON from Pexels response: {res.text}")
        return []
    except Exception as e:
        print(f"An unexpected error occurred in fetch_images: {e}")
        return []

# Streaming blog generator endpoint
@app.post("/generate")
async def generate(request: BlogRequest):
    """
    Generates a blog post in a streaming fashion using OpenRouter API
    and fetches relevant images from Pexels.
    """
    prompt = request.prompt
    if not prompt:
        return JSONResponse({"error": "No prompt provided"}, status_code=400)

    # Define the system message for the AI model
    system_msg = {
        "role": "system",
        "content": (
            "You are a creative blog writer.\n"
            "Use catchy headings (`##`), markdown (**bold**, *italic*, etc.),\n"
            "short paragraphs, bullet points, emojis 🎯, and end your response with a JSON object\n"
            "containing image search keywords, for example:\n"
            '`{"images": ["ai education", "future technology"]}`'
        )
    }
    conversation = [system_msg, {"role": "user", "content": prompt}]

    # Define the generator function for streaming the response
    def stream_generator():
        full_text = "" # Accumulates the full text for image keyword extraction later

        # Headers for the OpenRouter API request
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}", # Use the globally loaded API key
            "HTTP-Referer": "http://localhost:3000",  # Change this if deployed to a different URL
            "X-Title": "Blog Writer Agent",
            "Content-Type": "application/json",
        }

        print("\n🔐 Headers being sent to OpenRouter:")
        print(json.dumps(headers, indent=2))
        print("🤖 Requesting blog content from OpenRouter...")

        # Data payload for the OpenRouter API
        data = {
            "model": "google/gemini-2.0-flash-exp:free", # Updated to the requested model
            "messages": conversation,
            "stream": True, # Enable streaming
        }

        try:
            # Make the streaming POST request to OpenRouter
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=data,
                stream=True # Essential for streaming responses
            )

            # Check for non-200 status codes from OpenRouter
            if response.status_code != 200:
                error_detail = response.text
                print(f"OpenRouter API Error ({response.status_code}): {error_detail}")
                yield f"\n**Error from AI:** {error_detail}"
                return

            # Manually process the streamed response line by line
            for line in response.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    # OpenRouter often sends 'data: {json}' or just '{json}'
                    if decoded_line.startswith("data: "):
                        decoded_line = decoded_line[len("data: "):]
                    
                    if decoded_line == "[DONE]":
                        break # End of stream marker
                    
                    try:
                        payload = json.loads(decoded_line)
                        # Extract the content token from the payload
                        token = payload['choices'][0]['delta'].get('content', '')
                        if token:
                            full_text += token # Accumulate the text
                            yield token # Yield the token to the client
                    except json.JSONDecodeError:
                        print(f"Skipping non-JSON or malformed JSON line: {decoded_line}")
                        continue
                    except KeyError as e:
                        print(f"KeyError in OpenRouter payload: {e} - Line: {decoded_line}")
                        continue
            
            # After streaming, extract image keywords from the full accumulated text
            print("\n🔍 Extracting image keywords...")
            start_marker = '{"images":'
            start_index = full_text.rfind(start_marker)

            if start_index != -1:
                # Attempt to find the end of the JSON object
                json_part = full_text[start_index:]
                brace_count = 0
                end_index_relative = -1
                for i, char in enumerate(json_part):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                    if brace_count == 0 and char == '}':
                        end_index_relative = i
                        break
                
                if end_index_relative != -1:
                    json_block = json_part[:end_index_relative + 1]
                    try:
                        keywords_data = json.loads(json_block)
                        keywords = keywords_data.get("images", [])
                        print(f"🖼️ Found image keywords: {keywords}")
                        
                        image_urls = []
                        for kw in keywords:
                            # Fetch one image per keyword
                            image_urls.extend(fetch_images(kw, count=1))
                        
                        # Yield the image URLs in a special format for client-side parsing
                        yield f'\n<!--IMAGE_JSON_START-->{json.dumps(image_urls)}<!--IMAGE_JSON_END-->'
                        print("✅ Image URLs sent.")
                    except json.JSONDecodeError:
                        print(f"❌ Failed to decode image JSON block: {json_block}")
                else:
                    print("❌ Could not find a complete JSON block for images.")
            else:
                print("🤷 No image JSON block found in the full text.")

        except requests.exceptions.RequestException as req_e:
            # Handle network or request-specific errors
            print(f"Request Exception during OpenRouter call: {req_e}")
            yield f"\n**Network Error:** {str(req_e)}"
        except Exception as e:
            # Catch any other unexpected errors
            print(f"An unexpected error occurred during streaming: {e}")
            yield f"\n**Server Error:** An unexpected error occurred: {str(e)}"

    # Return the StreamingResponse with the generator
    return StreamingResponse(stream_generator(), media_type="text/plain")
