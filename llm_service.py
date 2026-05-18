# llm_service.py

import os
import time
import threading
import argparse
from datetime import datetime

import torch
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
import ollama

from sentence_transformers import CrossEncoder
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

# ================================
# CONFIG
# ================================
RAG_DATABASE_PATH = "rag_db"
RAG_DB_DEFAULT_NAME = "default"

EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CROSS_ENCODER_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
OLLAMA_LLM_MODEL_NAME = "gemma4:e2b"
DIRECT_LLM_MODEL_NAME = "google/gemma-4-E2B-it"
USE_OLLAMA = True
# ================================
# LOG
# ================================
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# ================================
# CACHE
# ================================
class SemanticCache:
    def __init__(self, embedding_model, threshold=0.85):
        self.embedding_model = embedding_model
        self.threshold = threshold
        self.entries = []

    def _embed(self, text):
        return self.embedding_model.embed_query(f"query: {text}")

    def query(self, question):
        if not self.entries:
            return None

        q_emb = self._embed(question)
        embs = [e["embedding"] for e in self.entries]

        sims = cosine_similarity([q_emb], embs)[0]
        idx = int(np.argmax(sims))

        if sims[idx] >= self.threshold:
            return self.entries[idx]["answer"]

        return None

    def add(self, question, answer):
        self.entries.append({
            "question": question,
            "answer": answer,
            "embedding": self._embed(question)
        })

# ================================
# PROMPT
# ================================
def build_prompt(context, question):
    return f"""
You are a helpful teaching assistant.

Answer the question using the context below.

Guidelines:
- Give a clear definition
- Then explain intuitively
- Include an example if possible
- Use your own words
- Do not generate additional questions

Context:
{context}

Question:
{question}

Answer:
"""

# ================================
# RAG BUILD
# ================================
def build_rag_database(document_path, embeddings):
    loader = PyPDFLoader(document_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
    chunks = splitter.split_documents(docs)

    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local(RAG_DATABASE_PATH)

    log(f"Built RAG DB from {document_path}")

# ================================
# RAG MANAGER
# ================================
class RAGManager:
    def __init__(self, embeddings):
        self.embeddings = embeddings
        self.vectorstores = {}
        self.active_db = None

    def load_db(self, db_path, db_name):
        vs = FAISS.load_local(
            db_path,
            self.embeddings,
            allow_dangerous_deserialization=True
        )
        self.vectorstores[db_name] = vs
        self.active_db = db_name
        log(f"Loaded DB '{db_name}'")

    def build_db(self, db_path, db_name, document_path):
        build_rag_database(document_path, self.embeddings)
        self.load_db(db_path, db_name)

    def switch_db(self, db_name):
        if db_name not in self.vectorstores:
            raise ValueError(f"DB {db_name} not loaded")
        self.active_db = db_name

    def get_active(self):
        if not self.active_db:
            raise ValueError("No active DB")
        return self.vectorstores[self.active_db]

# ================================
# MODEL
# ================================
loaded_direct_model = {"model": None, "tokenizer": None}

def load_direct_model(model_path=None, base_model_id="google/gemma-4-E2B-it"):
    
    global loaded_direct_model

    if not loaded_direct_model['model']:

        tokenizer = AutoTokenizer.from_pretrained(base_model_id)

        if model_path:
            base_model = AutoModelForCausalLM.from_pretrained(base_model_id, dtype=torch.float16, device_map="auto")
            model = PeftModel.from_pretrained(base_model, model_path)
        else:
            model = AutoModelForCausalLM.from_pretrained(base_model_id, dtype=torch.float16,  device_map="auto")

        tokenizer.pad_token = tokenizer.eos_token
        model.config.pad_token_id = tokenizer.pad_token_id
    
        loaded_direct_model['model'] = model
        loaded_direct_model['tokenizer'] = tokenizer

        loaded_direct_model['model'].eval()
    return loaded_direct_model['model'], loaded_direct_model['tokenizer']

# ================================
# GENERATION
# ================================
def generate_stream(prompt):
    if not loaded_direct_model['model']:
        return "Unable to find the local LLM model!!!"

    log("generate_stream Start streaming")
    inputs = loaded_direct_model['tokenizer'](prompt, return_tensors="pt").to(loaded_direct_model['model'].device)

    streamer = TextIteratorStreamer(
        loaded_direct_model['tokenizer'],
        skip_prompt=True,
        skip_special_tokens=True
    )

    thread = threading.Thread(
        target=loaded_direct_model['model'].generate,
        kwargs=dict(
            **inputs,
            max_new_tokens=300,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.1,
            streamer=streamer
        )
    )
    thread.start()

    for token in streamer:
        yield token

def generate_ollama(prompt):
    response = ollama.chat(
        model=OLLAMA_LLM_MODEL_NAME,
        messages=[{"role": "user", "content": prompt}]
    )
    return response["message"]["content"]

# ================================
# PIPELINE
# ================================
def retrieve_context(question):
    vs = rag_manager.get_active()

    docs = vs.max_marginal_relevance_search(question, k=6, fetch_k=20)
    docs = rerank_documents(question, docs)

    return "\n\n".join([d.page_content for d in docs])

def rerank_documents(question, docs, top_n=5):
    pairs = [(question, d.page_content) for d in docs]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
    return [d for d, _ in ranked[:top_n]]

def answer_question(question):
    cached = cache.query(question)
    if cached:
        return cached

    context = retrieve_context(question)
    prompt = build_prompt(context, question)

    start = time.perf_counter()
    if USE_OLLAMA:
        answer = generate_ollama(prompt)
        print(f"Ollama local LLM: model={OLLAMA_LLM_MODEL_NAME}, duration={(time.perf_counter() - start):.1f} seconds")
    else:
        answer = "".join(generate_stream(prompt))
        print(f"Direct local LLM: model={DIRECT_LLM_MODEL_NAME}, duration={(time.perf_counter() - start):.1f} seconds")

    cache.add(question, answer)
    return answer

# ================================
# FASTAPI
# ================================
app = FastAPI()

class QueryRequest(BaseModel):
    question: str
    db_name: str

@app.post("/query")
def query(req: QueryRequest):
    return {"answer": answer_question(req.question, req.db_name)}

@app.post("/query_stream")
def query_stream(req: QueryRequest):
    log(f"==================USE_OLLAMA={USE_OLLAMA}, received query_stream: {str(req)}")
    if req.db_name:
        rag_manager.switch_db(req.db_name)

    def stream():
        context = retrieve_context(req.question)

        prompt = build_prompt(context, req.question)
        start = time.perf_counter()
        if USE_OLLAMA:
            yield generate_ollama(prompt)
        else:
            for t in generate_stream(prompt):
                yield t
        print(f"query_stream: USE_OLLAMA={USE_OLLAMA}, duration={(time.perf_counter() - start):.1f} seconds")

    return StreamingResponse(stream(), media_type="text/plain")

# ---- RAG CONTROL APIs ----

class LoadDBRequest(BaseModel):
    name: str
    path: str

@app.post("/rag/load")
def load_db(req: LoadDBRequest):
    rag_manager.load_db(req.path, req.name)
    return {"active": rag_manager.active_db}

class BuildDBRequest(BaseModel):
    document_name: str

@app.post("/rag/build")
def build_db(req: BuildDBRequest):
    document_path = os.path.join('docs', req.document_name)
    log(f"build_db db_name={req.document_name}, document_path={document_path}")

    rag_manager.build_db(RAG_DATABASE_PATH, req.document_name, document_path)
    return {"active": rag_manager.active_db}

class SwitchDBRequest(BaseModel):
    name: str

@app.post("/rag/switch")
def switch_db(req: SwitchDBRequest):
    rag_manager.switch_db(req.name)
    return {"active": rag_manager.active_db}

@app.get("/rag/list")
def list_dbs():
    return {
        "loaded": list(rag_manager.vectorstores.keys()),
        "active": rag_manager.active_db
    }

@app.get("/health")
def health():
    return {"status": "ok"}

# ================================
# INIT
# ================================
log(f"INIT: Loading Embedding model {EMBEDDING_MODEL_NAME}")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME, encode_kwargs={"normalize_embeddings": True})

log(f"INIT: Loading CrossEncoder modeL {CROSS_ENCODER_NAME}")
reranker = CrossEncoder(CROSS_ENCODER_NAME)

rag_manager = RAGManager(embeddings)
cache = SemanticCache(embeddings)

# ================================
# CLI
# ================================
def run_cli(question):
    if not question:
        question = input("Question: ")

    print(answer_question(question))

# ================================
# MAIN
# ================================
def main():
    global USE_OLLAMA
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["cli", "api"], default="api")
    parser.add_argument("--question", type=str, default="can you describe embedding vector?")
    parser.add_argument("--rag_document", type=str, default="docs/SpeechAndLanguageProcessing_Ch8.pdf")
    parser.add_argument("--use_ollama", action="store_false")

    args = parser.parse_args()

    if args.rag_document:
        log(f"INIT: Building RAG database, db_path={RAG_DATABASE_PATH}, db_name={RAG_DB_DEFAULT_NAME}, document_path={args.rag_document}...")
        rag_manager.build_db(RAG_DATABASE_PATH, RAG_DB_DEFAULT_NAME, args.rag_document)
    else:
        log(f"INIT: Loading RAG database, db_path={RAG_DATABASE_PATH}...")
        rag_manager.load_db(RAG_DATABASE_PATH, RAG_DB_DEFAULT_NAME)

    # 🔹 Load once (critical)
    USE_OLLAMA = args.use_ollama
    if not USE_OLLAMA:
        log(f"INIT: Loading direct model {DIRECT_LLM_MODEL_NAME}...")
        load_direct_model(base_model_id=DIRECT_LLM_MODEL_NAME)

    if args.mode == "cli":
        run_cli(args.question)
    else:
        uvicorn.run(app, host="127.0.0.1", port=8000)

if __name__ == "__main__":
    main()