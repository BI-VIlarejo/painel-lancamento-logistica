"""Túnel SSH opcional para conectar a API local à RDS por uma EC2."""

from __future__ import annotations

import logging
import os
import shutil
import socket
import stat
import subprocess
import time
from pathlib import Path

from sqlalchemy.engine import make_url

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_tunnel_process: subprocess.Popen[str] | None = None
_tunneled_database_url: str | None = None


def _ssh_target() -> str:
    settings = get_settings()
    ec2_host = (settings.ec2_host or "").strip()
    if settings.use_tailscale:
        tailscale_ip = (settings.tailscale_ec2_ip or "").strip()
        if not tailscale_ip:
            raise RuntimeError("TAILSCALE_EC2_IP precisa estar configurado.")
        username = ec2_host.partition("@")[0] if "@" in ec2_host else "ubuntu"
        return f"{username}@{tailscale_ip}"

    if not ec2_host:
        raise RuntimeError("EC2_HOST precisa estar configurado para o túnel SSH.")
    return ec2_host


def _rds_target() -> tuple[str, int]:
    settings = get_settings()
    database_url = settings.op_logistica_database_url
    if not database_url:
        raise RuntimeError("OP_LOGISTICA_DATABASE_URL precisa estar configurado.")

    url = make_url(database_url)
    endpoint = (settings.rds_endpoint or "").strip()
    if endpoint:
        host = endpoint
        port = 3306
        if ":" in endpoint:
            candidate_host, candidate_port = endpoint.rsplit(":", maxsplit=1)
            if candidate_port.isdigit():
                host, port = candidate_host, int(candidate_port)
        if url.host and url.host.rstrip(".").lower() != host.rstrip(".").lower():
            raise RuntimeError(
                "RDS_ENDPOINT precisa corresponder ao host de "
                "OP_LOGISTICA_DATABASE_URL."
            )
        return host, port

    if not url.host:
        raise RuntimeError("A URL operacional não contém o host da RDS.")
    return url.host, url.port or 3306


def _reserve_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    if process.stderr is not None:
        process.stderr.close()


def _wait_for_tunnel(process: subprocess.Popen[str], local_port: int) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            _, error_output = process.communicate()
            detail = (error_output or "").strip()
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"O SSH encerrou antes de abrir o túnel{suffix}")
        try:
            with socket.create_connection(("127.0.0.1", local_port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("O túnel SSH não abriu a porta local dentro de 15 segundos.")


def start_database_tunnel() -> None:
    """Abre o túnel quando solicitado e prepara a URL local do banco."""
    global _tunnel_process, _tunneled_database_url

    settings = get_settings()
    if not settings.use_db_tunnel:
        return
    if _tunnel_process is not None and _tunnel_process.poll() is None:
        return

    if not settings.ssh_key_path:
        raise RuntimeError("SSH_KEY_PATH precisa estar configurado para o túnel SSH.")
    key_path = Path(settings.ssh_key_path).expanduser()
    if not key_path.is_file():
        raise FileNotFoundError(f"A chave SSH não foi encontrada em {key_path}.")
    if stat.S_IMODE(key_path.stat().st_mode) & 0o077:
        raise PermissionError(
            "A chave SSH deve ser legível somente pelo proprietário; use chmod 600."
        )

    ssh_binary = shutil.which("ssh")
    if not ssh_binary:
        raise RuntimeError("O cliente OpenSSH (comando ssh) não está instalado.")

    database_url = settings.op_logistica_database_url
    if not database_url:
        raise RuntimeError("OP_LOGISTICA_DATABASE_URL precisa estar configurado.")
    rds_host, rds_port = _rds_target()
    local_port = _reserve_local_port()
    known_hosts = Path.home() / ".ssh" / "known_hosts"
    command = [
        ssh_binary,
        "-N",
        "-T",
        "-p",
        "22",
        "-i",
        str(key_path),
        "-L",
        f"127.0.0.1:{local_port}:{rds_host}:{rds_port}",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=60",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={known_hosts}",
        _ssh_target(),
    ]

    process = subprocess.Popen(
        command,
        env={
            "HOME": str(Path.home()),
            "PATH": os.environ.get("PATH", os.defpath),
            **{
                name: os.environ[name]
                for name in ("LANG", "LC_ALL")
                if name in os.environ
            },
        },
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        _wait_for_tunnel(process, local_port)
    except Exception:
        _stop_process(process)
        raise

    _tunnel_process = process
    _tunneled_database_url = str(
        make_url(database_url)
        .set(host="127.0.0.1", port=local_port)
        .render_as_string(hide_password=False)
    )
    logger.info("Túnel SSH para a RDS estabelecido pela rede configurada.")


def get_database_url() -> str | None:
    """Retorna a URL direta ou a URL local encaminhada pelo túnel."""
    settings = get_settings()
    if settings.use_db_tunnel:
        if _tunneled_database_url is None:
            raise RuntimeError(
                "O túnel SSH ainda não foi iniciado; verifique o lifespan da API."
            )
        return _tunneled_database_url
    return settings.op_logistica_database_url


def stop_database_tunnel() -> None:
    """Fecha o processo SSH e limpa a URL encaminhada ao encerrar a API."""
    global _tunnel_process, _tunneled_database_url

    process = _tunnel_process
    _tunnel_process = None
    _tunneled_database_url = None
    if process is not None:
        _stop_process(process)
        logger.info("Túnel SSH para a RDS encerrado.")
