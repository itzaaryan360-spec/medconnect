import os
from dotenv import load_dotenv
load_dotenv()
import google.generativeai as genai
from openai import OpenAI
import base64

def test_summary():
    google_key = os.environ.get("GOOGLE_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    
    print(f"Google Key: {google_key[:10] if google_key else 'None'}...")
    print(f"OpenAI Key: {openai_key[:10] if openai_key else 'None'}...")

    # Mock file bytes (white pixel)
    file_bytes = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    filename = "test.gif"
    
    try:
        genai.configure(api_key=google_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        print("Testing Gemini...")
        # response = model.generate_content([{'mime_type': 'image/gif', 'data': file_bytes}, "Say hello"])
        # print("Gemini Response:", response.text)
    except Exception as e:
        print("Gemini Error:", e)

    try:
        client = OpenAI(api_key=openai_key)
        print("Testing OpenAI...")
        # response = client.chat.completions.create(
        #     model="gpt-4o",
        #     messages=[{"role": "user", "content": "Say hello"}],
        #     max_tokens=10
        # )
        # print("OpenAI Response:", response.choices[0].message.content)
    except Exception as e:
        print("OpenAI Error:", e)

if __name__ == "__main__":
    test_summary()
