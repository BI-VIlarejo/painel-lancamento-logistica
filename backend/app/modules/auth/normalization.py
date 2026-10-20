"""Normalização canônica do username local."""

def normalize_username(username: str) -> str:
    """Remove espaços externos e converte o username para minúsculas."""
    return username.strip().lower()
