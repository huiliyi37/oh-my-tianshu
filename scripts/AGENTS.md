# AGENTS.md — Repository scripts

Gate scripts invoke pnpm shell-free, normalize repository-relative glob paths to `/` at ingestion, and keep platform adaptation at the owning gate boundary instead of a shared platform layer.
