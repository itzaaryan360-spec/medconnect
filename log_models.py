import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

def list_models():
    api_key = os.environ.get("GOOGLE_API_KEY")
    genai.configure(api_key=api_key)
    with open("models_list.txt", "w") as f:
        try:
            for m in genai.list_models():
                f.write(f"{m.name}\n")
        except Exception as e:
            f.write(f"Error: {e}\n")

if __name__ == "__main__":
    list_models()
