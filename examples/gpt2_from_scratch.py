# gpt2_from_scratch.py
# Full GPT-2 style implementation using nn.Module (no HuggingFace)
# Includes: model, training loop, tokenizer (simple), generation

import torch
import torch.nn as nn
import torch.nn.functional as F
import math
import random

# ================================
# Simple tokenizer (char-level)
# ================================
class CharTokenizer:
    def __init__(self, text):
        chars = sorted(list(set(text)))
        self.stoi = {ch: i for i, ch in enumerate(chars)}
        self.itos = {i: ch for ch, i in self.stoi.items()}
        self.vocab_size = len(chars)

    def encode(self, s):
        return [self.stoi[c] for c in s]

    def decode(self, tokens):
        return ''.join([self.itos[t] for t in tokens])


# ================================
# Causal Self Attention
# ================================
class CausalSelfAttention(nn.Module):
    def __init__(self, d_model, nhead):
        super().__init__()
        assert d_model % nhead == 0

        self.nhead = nhead
        self.head_dim = d_model // nhead

        self.c_attn = nn.Linear(d_model, 3 * d_model)
        self.c_proj = nn.Linear(d_model, d_model)

    def forward(self, x):
        B, T, C = x.shape

        qkv = self.c_attn(x)
        q, k, v = qkv.split(C, dim=2)

        q = q.view(B, T, self.nhead, self.head_dim).transpose(1, 2)
        k = k.view(B, T, self.nhead, self.head_dim).transpose(1, 2)
        v = v.view(B, T, self.nhead, self.head_dim).transpose(1, 2)

        att = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)

        mask = torch.tril(torch.ones(T, T, device=x.device)).view(1, 1, T, T)
        att = att.masked_fill(mask == 0, float('-inf'))

        att = F.softmax(att, dim=-1)

        y = att @ v
        y = y.transpose(1, 2).contiguous().view(B, T, C)

        return self.c_proj(y)


# ================================
# MLP
# ================================
class MLP(nn.Module):
    def __init__(self, d_model):
        super().__init__()
        self.fc1 = nn.Linear(d_model, 4 * d_model)
        self.fc2 = nn.Linear(4 * d_model, d_model)

    def forward(self, x):
        return self.fc2(F.gelu(self.fc1(x)))


# ================================
# Transformer Block
# ================================
class Block(nn.Module):
    def __init__(self, d_model, nhead):
        super().__init__()
        self.ln1 = nn.LayerNorm(d_model)
        self.attn = CausalSelfAttention(d_model, nhead)
        self.ln2 = nn.LayerNorm(d_model)
        self.mlp = MLP(d_model)

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        x = x + self.mlp(self.ln2(x))
        return x


# ================================
# GPT-2 Model
# ================================
class GPT2(nn.Module):
    def __init__(self, vocab_size, max_len=256, d_model=256, nhead=4, num_layers=4):
        super().__init__()

        self.token_emb = nn.Embedding(vocab_size, d_model)
        self.pos_emb = nn.Parameter(torch.zeros(1, max_len, d_model))

        self.blocks = nn.ModuleList([
            Block(d_model, nhead) for _ in range(num_layers)
        ])

        self.ln_f = nn.LayerNorm(d_model)
        self.lm_head = nn.Linear(d_model, vocab_size, bias=False)

        # weight tying
        self.lm_head.weight = self.token_emb.weight

    def forward(self, idx):
        B, T = idx.shape

        ##Pseudocode [line 2: Compute token embeddings: H₀ = E(X)]##
        tok = self.token_emb(idx)

        ##Pseudocode [line 3: Add positional embeddings: H₀ = H₀ + P[0:T]]##
        pos = self.pos_emb[:, :T, :]
        x = tok + pos

        ##Pseudocode [line 4: for ℓ = 1 to L do]##
        for block in self.blocks:
            ##Pseudocode [line 5: H_norm = LayerNorm(H_{ℓ-1})]##
            ##Pseudocode [line 6: A = MultiHeadSelfAttention(H_norm, causal_mask)]##
            ##Pseudocode [line 7: H' = H_{ℓ-1} + A]##
            ##Pseudocode [line 8: H_norm = LayerNorm(H')]##
            ##Pseudocode [line 9: M = FeedForward(H_norm)]##
            ##Pseudocode [line 10: H_ℓ = H' + M]##
            x = block(x)

        ##Pseudocode [line 12: Apply final normalization: H_L = LN_f(H_L)]##
        x = self.ln_f(x)

        ##Pseudocode [line 13: Compute output logits: Z = W_out(H_L)]##
        logits = self.lm_head(x)

        ##Pseudocode [line 14: return Z]##
        return logits


# ================================
# Training
# ================================
def get_batch(data, batch_size, block_size):
    ix = torch.randint(len(data) - block_size, (batch_size,))
    x = torch.stack([data[i:i+block_size] for i in ix])
    y = torch.stack([data[i+1:i+block_size+1] for i in ix])
    return x, y


def train(model, data, epochs=200, batch_size=32, block_size=64, lr=3e-4):
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)

    for step in range(epochs):
        xb, yb = get_batch(data, batch_size, block_size)

        ##Pseudocode [line 16: Construct input-target pairs: X_in  = X[:, 0:T-1] and X_tar = X[:, 1:T]]##
        ##Pseudocode [line 17: Forward pass: Z = ModelForward(X_in; θ)]##
        logits = model(xb)

        ##Pseudocode [line 18: Compute probabilities: P = softmax(Z)]##
        ##Pseudocode [line 19: Compute loss (cross-entropy): L = - (1 / (B(T-1))) * Σ log P(X_tar)]##
        loss = F.cross_entropy(
            logits.view(-1, logits.size(-1)),
            yb.view(-1)
        )

        ##Pseudocode [line 20: Backpropagation: Compute gradients ∇θ L]##
        optimizer.zero_grad()
        loss.backward()

        ##Pseudocode [line 21: Parameter update: θ ← θ - α ∇θ L]##
        optimizer.step()

        ##Pseudocode [line 22: return θ, L]##
        if step % 20 == 0:
            print(f"Step {step}, Loss: {loss.item():.4f}")


# ================================
# Generation
# ================================
@torch.no_grad()
def generate(model, idx, max_new_tokens=100, temperature=1.0):
    for _ in range(max_new_tokens):
        logits = model(idx)
        logits = logits[:, -1, :] / temperature
        probs = F.softmax(logits, dim=-1)
        next_token = torch.multinomial(probs, num_samples=1)
        idx = torch.cat([idx, next_token], dim=1)
    return idx


# ================================
# MAIN
# ================================
if __name__ == "__main__":
    text = open("input.txt", "r", encoding="utf-8").read()

    tokenizer = CharTokenizer(text)
    data = torch.tensor(tokenizer.encode(text), dtype=torch.long)

    model = GPT2(vocab_size=tokenizer.vocab_size)

    print("Training model...")
    train(model, data)

    context = torch.tensor([[0]], dtype=torch.long)
    out = generate(model, context, max_new_tokens=200)

    print("\nGenerated text:\n")
    print(tokenizer.decode(out[0].tolist()))