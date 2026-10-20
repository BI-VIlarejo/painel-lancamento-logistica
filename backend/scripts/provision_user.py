"""Cria interativamente uma conta local sem endpoint público de cadastro."""

from datetime import UTC, datetime
from getpass import getpass

from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.database import dispose_engine, get_session_factory
from app.core.security import InvalidPassword, hash_password
from app.modules.auth import repository
from app.modules.auth.models import Usuario
from app.modules.auth.normalization import normalize_username


def main() -> int:
    """Solicita os dados sem ecoar a senha e grava uma conta ativa."""
    username = normalize_username(input("Username: "))
    if not username or len(username) > 80:
        print("Username inválido: informe de 1 a 80 caracteres.")
        return 2

    nome_completo = input("Nome completo: ").strip()
    if not nome_completo or len(nome_completo) > 160:
        print("Nome inválido: informe de 1 a 160 caracteres.")
        return 2

    session_factory = get_session_factory()
    if session_factory is None:
        print("OP_LOGISTICA_DATABASE_URL não está configurada.")
        return 2

    db = session_factory()
    try:
        if repository.get_user_by_username(db, username) is not None:
            print("Já existe uma conta com esse username.")
            return 1
        db.rollback()

        password = getpass("Senha nova (mínimo 6 caracteres): ")
        confirmation = getpass("Confirme a senha: ")
        if password != confirmation:
            print("As senhas não coincidem.")
            return 2

        try:
            encoded_hash = hash_password(password)
        except InvalidPassword as exc:
            print(str(exc))
            return 2

        now = datetime.now(UTC).replace(tzinfo=None)
        user = Usuario(
            username=username,
            nome_completo=nome_completo,
            ativo=True,
            criado_em=now,
            atualizado_em=now,
            hash_senha=encoded_hash,
            senha_alterada_em=now,
            troca_senha_obrigatoria=False,
        )
        db.add(user)
        db.commit()
        print(
            f"Conta criada: id_usuario={user.id_usuario}, username={username}. "
            "Conceda perfil e escopo separadamente "
            "antes de liberar acesso aos módulos."
        )
        return 0
    except IntegrityError:
        db.rollback()
        print("Já existe uma conta com esse username.")
        return 1
    except SQLAlchemyError:
        db.rollback()
        print(
            "Não foi possível criar a conta. Confira a conexão e se as migrations "
            "operacionais foram aplicadas."
        )
        return 1
    finally:
        db.close()
        dispose_engine()


if __name__ == "__main__":
    raise SystemExit(main())
