from datetime import datetime, timedelta, timezone
import hashlib, secrets
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from .config import settings

class Base(DeclarativeBase): pass
class User(Base):
    __tablename__="users"; id: Mapped[str]=mapped_column(String,primary_key=True); created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
class AuthSession(Base):
    __tablename__="auth_sessions"; id: Mapped[str]=mapped_column(String,primary_key=True); user_id: Mapped[str]=mapped_column(ForeignKey("users.id")); token_hash: Mapped[str|None]=mapped_column(String,nullable=True); created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True)); expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
class Workspace(Base):
    __tablename__="workspaces"; user_id: Mapped[str]=mapped_column(ForeignKey("users.id"),primary_key=True); state: Mapped[str]=mapped_column(Text); version: Mapped[int]=mapped_column(Integer); updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
class UserAiConfig(Base):
    __tablename__="user_ai_configs"; user_id: Mapped[str]=mapped_column(ForeignKey("users.id"),primary_key=True); version: Mapped[int]=mapped_column(Integer); base_url: Mapped[str]=mapped_column(Text); model: Mapped[str]=mapped_column(String); timeout_ms: Mapped[int]=mapped_column(Integer); encrypted_key: Mapped[str]=mapped_column(Text); nonce: Mapped[str]=mapped_column(String); auth_tag: Mapped[str|None]=mapped_column(String,nullable=True); updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
engine=create_engine(settings.database_url, connect_args={"check_same_thread":False} if settings.database_url.startswith("sqlite") else {})
def utcnow(): return datetime.now(timezone.utc)
def token_hash(token): return hashlib.sha256(token.encode()).hexdigest()
def new_session(db: Session):
    user=User(id=secrets.token_urlsafe(24),created_at=utcnow()); token=secrets.token_urlsafe(48); db.add_all([user,AuthSession(id=secrets.token_urlsafe(24),user_id=user.id,token_hash=token_hash(token),created_at=utcnow(),expires_at=utcnow()+timedelta(days=30))]); db.commit(); return user.id,token
