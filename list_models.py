import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def list_models():
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("No Google API Key found.")
        return
    
    genai.configure(api_key=api_key)
    print("Listing available Gemini models...")
    try:
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"Model: {m.name}, Display Name: {m.display_name}")
    except Exception as e:
        print(f"Error listing models: {e}")

if __name__ == "__main__":
    list_models()
