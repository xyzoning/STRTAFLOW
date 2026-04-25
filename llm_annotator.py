import ollama
import os

def annotate_python_code(pseudo_code_file, python_code_file, output_file=None):
    # Read input files
    with open(pseudo_code_file, "r", encoding="utf-8") as f:
        pseudo_code = f.read()

    with open(python_code_file, "r", encoding="utf-8") as f:
        python_code = f.read()

    # Build prompt
    prompt = f"""
You are given:

1. Pseudocode describing an algorithm
2. Python implementation of that algorithm

Task:
Insert each pseudocode step as Python comments directly above the corresponding code lines.

Rules:
- Do NOT modify the original Python code
- Only add comments using the EXACT format:
  ##Pseudocode [line X: <pseudocode text>]##
- X must be the line number from the pseudocode (starting from 1)
- <pseudocode text> must be copied exactly from the pseudocode (no paraphrasing)
- Preserve formatting and indentation
- If one pseudocode step maps to multiple lines, place it above the block
- If no match exists, skip that pseudocode step
- Return ONLY the full annotated Python code (no explanations)

Pseudocode:
{pseudo_code}

Python code:
{python_code}
"""

    annotated_code = "##Pseudocode [line 11: Initialize the “old” actor network θAold]##\n\n" + python_code
    if True:
        # Call Ollama
        response = ollama.chat(
            model="gemma4:e4b",
            messages=[{"role": "user", "content": prompt}]
        )

        annotated_code = response["message"]["content"]

    # Decide output path
    if output_file is None:
        base, ext = os.path.splitext(python_code_file)
        output_file = f"{base}_annotated{ext}"

    # Save annotated file
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(annotated_code)

    return output_file

import argparse

def main():
    parser = argparse.ArgumentParser(description="Algorithm Annotation Tool")

    # Add the specific arguments with defaults
    parser.add_argument(
        "--pseudo", 
        type=str, 
        default="examples/ppo.txt", 
        help="Path to the pseudocode text file"
    )
    
    parser.add_argument(
        "--source", 
        type=str, 
        default="examples/ppo.py", 
        help="Path to the Python source file"
    )

    # Parse the arguments
    args = parser.parse_args()

    output = annotate_python_code(args.pseudo, args.source)
    print("Annotated file saved to:", output)

if __name__ == "__main__":
    main()

