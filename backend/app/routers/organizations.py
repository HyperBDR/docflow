import re
import uuid
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import Demo, ExtensionToken, Organization, OrganizationInvitation, OrganizationMember, Session as UserSession, ShareToken, User
from app.routers.auth import create_session
from app.schemas import (
    InvitationCreate, InvitationOut, InvitationRegister, OrganizationCreate, OrganizationMemberOut,
    OrganizationMemberUpdate, OrganizationOut, OrganizationUpdate, UserOut,
)
from app.security import expires_in, hash_password, hash_token, random_token, utcnow
from app.services import create_personal_organization, organization_membership, require_organization_role, write_audit
from app.quota import enforce

router = APIRouter(prefix="/api", tags=["organizations"])


def unique_slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "workspace"
    candidate = base
    while db.scalar(select(Organization.id).where(Organization.slug == candidate)):
        candidate = f"{base}-{uuid.uuid4().hex[:6]}"
    return candidate


def organization_out(db: Session, organization: Organization, role: str, access_source: str = "membership") -> OrganizationOut:
    return OrganizationOut(
        id=organization.id, name=organization.name, slug=organization.slug,
        kind=organization.kind, status=organization.status, role=role, access_source=access_source,
        member_count=db.scalar(select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == organization.id
        )) or 0,
        demo_count=db.scalar(select(func.count(Demo.id)).where(
            Demo.organization_id == organization.id, Demo.deleted_at.is_(None)
        )) or 0,
        created_at=organization.created_at,
    )


def member_out(member: OrganizationMember, user: User) -> OrganizationMemberOut:
    return OrganizationMemberOut(
        id=member.id, user_id=user.id, name=user.name or "", email=user.email,
        role=member.role, is_active=user.is_active and not bool(user.deleted_at), created_at=member.created_at,
    )


def invitation_out(invitation: OrganizationInvitation, organization: Organization, token: str | None = None) -> InvitationOut:
    return InvitationOut(
        id=invitation.id, email=invitation.email, role=invitation.role,
        organization_id=organization.id, organization_name=organization.name,
        invite_url=f"{settings.web_origin}/invite/{token}" if token else None,
        expires_at=invitation.expires_at, accepted_at=invitation.accepted_at, created_at=invitation.created_at,
    )


@router.get("/organizations", response_model=list[OrganizationOut])
def list_organizations(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role == "admin":
        memberships = {
            item.organization_id: item for item in db.scalars(select(OrganizationMember).where(
                OrganizationMember.user_id == user.id
            )).all()
        }
        organizations = db.scalars(select(Organization).where(
            Organization.status == "active",
            or_(Organization.kind == "team", Organization.id.in_(memberships)),
        ).order_by(Organization.kind, Organization.name)).all()
        return [organization_out(
            db, organization, memberships.get(organization.id).role if organization.id in memberships else "admin",
            "membership" if organization.id in memberships else "platform_admin",
        ) for organization in organizations]
    rows = db.execute(select(OrganizationMember, Organization).join(
        Organization, Organization.id == OrganizationMember.organization_id
    ).where(OrganizationMember.user_id == user.id, Organization.status == "active").order_by(Organization.kind, Organization.name)).all()
    return [organization_out(db, organization, membership.role) for membership, organization in rows]


@router.post("/organizations", response_model=OrganizationOut, status_code=201)
def create_organization(payload: OrganizationCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role != "admin" and not settings.allow_user_create_team_space:
        raise HTTPException(status_code=403, detail="team space creation is restricted")
    owner = user
    if payload.owner_id and user.role == "admin":
        owner = db.get(User, payload.owner_id)
        if not owner or owner.deleted_at or not owner.is_active:
            raise HTTPException(status_code=404, detail="user not found")
    organization = Organization(name=payload.name.strip(), slug=unique_slug(db, payload.name), kind="team", status="active", created_by_id=user.id)
    db.add(organization); db.flush()
    db.add(OrganizationMember(organization_id=organization.id, user_id=owner.id, role="owner"))
    write_audit(db, user, "organization.created", "organization", organization.id, organization.name, organization.id, request=request)
    db.commit(); db.refresh(organization)
    return organization_out(db, organization, "owner" if owner.id == user.id else "admin", "membership" if owner.id == user.id else "platform_admin")


@router.patch("/organizations/{organization_id}", response_model=OrganizationOut)
def update_organization(organization_id: str, payload: OrganizationUpdate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    membership = require_organization_role(db, user, organization_id, {"owner"})
    organization = db.get(Organization, organization_id)
    before = {"name": organization.name}
    organization.name = payload.name.strip()
    write_audit(db, user, "organization.updated", "organization", organization.id, organization.name, organization.id, before, {"name": organization.name}, request)
    db.commit(); db.refresh(organization)
    return organization_out(db, organization, membership.role)


@router.post("/organizations/{organization_id}/archive", status_code=204)
def archive_organization(
    organization_id: str, request: Request,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    organization = db.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="organization not found")
    if organization.kind != "team":
        raise HTTPException(status_code=400, detail="personal spaces cannot be archived")
    if organization.status == "archived":
        membership = organization_membership(db, user, organization_id)
        if user.role != "admin" and (not membership or membership.role != "owner"):
            raise HTTPException(status_code=403, detail="organization permission denied")
        return Response(status_code=204)
    require_organization_role(db, user, organization_id, {"owner"})
    archived_at = utcnow()
    organization.status = "archived"
    organization.archived_at = archived_at
    organization.archived_by_id = user.id
    organization.scheduled_purge_at = archived_at + timedelta(days=30)
    demo_ids = select(Demo.id).where(Demo.organization_id == organization.id)
    db.execute(update(ShareToken).where(ShareToken.demo_id.in_(demo_ids)).values(revoked=True))
    db.execute(update(UserSession).where(UserSession.active_organization_id == organization.id).values(active_organization_id=None))
    db.execute(update(ExtensionToken).where(ExtensionToken.active_organization_id == organization.id).values(active_organization_id=None))
    member_users = db.scalars(select(User).join(
        OrganizationMember, OrganizationMember.user_id == User.id
    ).where(OrganizationMember.organization_id == organization.id)).all()
    for account in member_users:
        if account.current_organization_id != organization.id:
            continue
        personal = db.scalar(select(Organization).where(
            Organization.kind == "personal", Organization.personal_owner_id == account.id,
            Organization.status == "active",
        ))
        account.current_organization_id = personal.id if personal else None
    write_audit(db, user, "organization.archived", "organization", organization.id, organization.name, organization.id, before={"status": "active"}, after={"status": "archived"}, request=request)
    db.commit()
    return Response(status_code=204)


@router.post("/organizations/{organization_id}/switch", response_model=UserOut)
def switch_organization(organization_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    organization = db.get(Organization, organization_id)
    membership = organization_membership(db, user, organization_id)
    if not organization or organization.status != "active" or (not membership and user.role != "admin"):
        raise HTTPException(status_code=403, detail="organization permission denied")
    credential = request.state.credential
    before = {"organization_id": user.active_organization_id}
    credential.active_organization_id = organization_id
    if membership:
        user.current_organization_id = organization_id
    user._active_organization_id = organization_id
    write_audit(db, user, "organization.entered", "organization", organization.id, organization.name, organization.id, before, {"platform_admin": not bool(membership)}, request)
    db.commit(); db.refresh(user)
    user._active_organization_id = organization_id
    return user


@router.get("/organizations/{organization_id}/members", response_model=list[OrganizationMemberOut])
def list_members(organization_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_organization_role(db, user, organization_id, {"owner", "admin", "editor", "viewer"})
    rows = db.execute(select(OrganizationMember, User).join(User, User.id == OrganizationMember.user_id).where(
        OrganizationMember.organization_id == organization_id, User.deleted_at.is_(None)
    ).order_by(OrganizationMember.created_at)).all()
    return [member_out(member, account) for member, account in rows]


@router.patch("/organizations/{organization_id}/members/{member_id}", response_model=OrganizationMemberOut)
def update_member(organization_id: str, member_id: str, payload: OrganizationMemberUpdate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    actor_membership = require_organization_role(db, user, organization_id, {"owner", "admin"})
    organization = db.get(Organization, organization_id)
    if organization.kind == "personal":
        raise HTTPException(status_code=400, detail="personal space membership is immutable")
    member = db.scalar(select(OrganizationMember).where(OrganizationMember.id == member_id, OrganizationMember.organization_id == organization_id))
    if not member:
        raise HTTPException(status_code=404, detail="organization member not found")
    if user.role != "admin" and actor_membership.role == "admin" and (member.role in {"owner", "admin"} or payload.role in {"owner", "admin"}):
        raise HTTPException(status_code=403, detail="only owners can manage elevated team roles")
    if member.role == "owner" and payload.role != "owner":
        owners = db.scalar(select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == organization_id, OrganizationMember.role == "owner"
        )) or 0
        if owners <= 1:
            raise HTTPException(status_code=400, detail="at least one organization owner is required")
    before = {"role": member.role}; member.role = payload.role
    account = db.get(User, member.user_id)
    write_audit(db, user, "member.role_updated", "member", member.id, account.email, organization_id, before, {"role": member.role}, request)
    db.commit(); db.refresh(member)
    return member_out(member, account)


@router.delete("/organizations/{organization_id}/members/{member_id}", status_code=204)
def remove_member(organization_id: str, member_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    actor_membership = require_organization_role(db, user, organization_id, {"owner", "admin"})
    organization = db.get(Organization, organization_id)
    if organization.kind == "personal":
        raise HTTPException(status_code=400, detail="personal space membership is immutable")
    member = db.scalar(select(OrganizationMember).where(OrganizationMember.id == member_id, OrganizationMember.organization_id == organization_id))
    if not member:
        raise HTTPException(status_code=404, detail="organization member not found")
    if user.role != "admin" and actor_membership.role == "admin" and member.role in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="only owners can manage elevated team roles")
    if member.role == "owner":
        owners = db.scalar(select(func.count(OrganizationMember.id)).where(OrganizationMember.organization_id == organization_id, OrganizationMember.role == "owner")) or 0
        if owners <= 1:
            raise HTTPException(status_code=400, detail="at least one organization owner is required")
    account = db.get(User, member.user_id)
    write_audit(db, user, "member.removed", "member", member.id, account.email, organization_id, before={"role": member.role}, request=request)
    db.delete(member)
    if account.current_organization_id == organization_id:
        personal = db.scalar(select(Organization).where(
            Organization.kind == "personal", Organization.personal_owner_id == account.id,
            Organization.status == "active",
        ))
        account.current_organization_id = personal.id if personal else None
    db.execute(update(UserSession).where(
        UserSession.user_id == account.id, UserSession.active_organization_id == organization_id
    ).values(active_organization_id=None))
    db.execute(update(ExtensionToken).where(
        ExtensionToken.user_id == account.id, ExtensionToken.active_organization_id == organization_id
    ).values(active_organization_id=None))
    db.commit()


@router.post("/organizations/{organization_id}/invitations", response_model=InvitationOut, status_code=201)
def create_invitation(organization_id: str, payload: InvitationCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_organization_role(db, user, organization_id, {"owner", "admin"})
    if payload.role == "owner":
        raise HTTPException(status_code=400, detail="owners cannot be invited directly")
    organization = db.get(Organization, organization_id)
    if organization.kind != "team":
        raise HTTPException(status_code=400, detail="personal spaces cannot have members")
    email = payload.email.lower()
    existing_user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))
    if existing_user and organization_membership(db, existing_user, organization_id):
        raise HTTPException(status_code=409, detail="user is already an organization member")
    enforce(db, organization_id, "members")
    token = random_token(32)
    invitation = OrganizationInvitation(
        organization_id=organization_id, email=email, role=payload.role,
        token_hash=hash_token(token), invited_by_id=user.id, expires_at=expires_in(days=7),
    )
    db.add(invitation); db.flush()
    write_audit(db, user, "invitation.created", "invitation", invitation.id, email, organization_id, after={"role": payload.role}, request=request)
    db.commit(); db.refresh(invitation)
    return invitation_out(invitation, organization, token)


@router.get("/organizations/{organization_id}/invitations", response_model=list[InvitationOut])
def list_invitations(organization_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_organization_role(db, user, organization_id, {"owner", "admin"})
    organization = db.get(Organization, organization_id)
    values = db.scalars(select(OrganizationInvitation).where(
        OrganizationInvitation.organization_id == organization_id
    ).order_by(OrganizationInvitation.created_at.desc())).all()
    return [invitation_out(item, organization) for item in values]


def valid_invitation(db: Session, token: str) -> tuple[OrganizationInvitation, Organization]:
    invitation = db.scalar(select(OrganizationInvitation).where(OrganizationInvitation.token_hash == hash_token(token)))
    expires_at = invitation.expires_at.replace(tzinfo=timezone.utc) if invitation and invitation.expires_at.tzinfo is None else invitation.expires_at if invitation else None
    if not invitation or invitation.accepted_at or expires_at < utcnow():
        raise HTTPException(status_code=404, detail="invitation not found or expired")
    organization = db.get(Organization, invitation.organization_id)
    if not organization or organization.status != "active":
        raise HTTPException(status_code=403, detail="organization is archived")
    return invitation, organization


@router.get("/invitations/{token}", response_model=InvitationOut)
def invitation_info(token: str, db: Session = Depends(get_db)):
    invitation, organization = valid_invitation(db, token)
    return invitation_out(invitation, organization)


def accept_for_user(db: Session, invitation: OrganizationInvitation, user: User) -> None:
    if user.email.lower() != invitation.email.lower():
        raise HTTPException(status_code=403, detail="invitation email does not match account")
    if not organization_membership(db, user, invitation.organization_id):
        enforce(db,invitation.organization_id,"members")
        db.add(OrganizationMember(organization_id=invitation.organization_id, user_id=user.id, role=invitation.role))
    user.current_organization_id = invitation.organization_id
    invitation.accepted_at = utcnow()


@router.post("/invitations/{token}/accept", response_model=UserOut)
def accept_invitation(token: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    invitation, organization = valid_invitation(db, token)
    accept_for_user(db, invitation, user)
    request.state.credential.active_organization_id = organization.id
    user._active_organization_id = organization.id
    write_audit(db, user, "invitation.accepted", "invitation", invitation.id, user.email, organization.id, request=request)
    db.commit(); db.refresh(user)
    user._active_organization_id = organization.id
    return user


@router.post("/invitations/{token}/register", response_model=UserOut, status_code=201)
def register_invitation(token: str, payload: InvitationRegister, response: Response, request: Request, db: Session = Depends(get_db)):
    invitation, organization = valid_invitation(db, token)
    if db.scalar(select(User.id).where(User.email == invitation.email)):
        raise HTTPException(status_code=409, detail="email already registered")
    user = User(
        email=invitation.email, name=payload.name.strip() or invitation.email.split("@", 1)[0],
        password_hash=hash_password(payload.password), role="user", ui_locale=payload.ui_locale,
    )
    db.add(user); db.flush()
    create_personal_organization(db, user)
    accept_for_user(db, invitation, user)
    write_audit(db, user, "invitation.accepted", "invitation", invitation.id, user.email, organization.id, request=request)
    create_session(db, user, response)
    return user
