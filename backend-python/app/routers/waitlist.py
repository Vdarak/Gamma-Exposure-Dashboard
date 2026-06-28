import logging
import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, update
from typing import Optional, Dict, Any
from app.database import get_db
from app.models.billing import WaitlistSignup
from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.waitlist")

router = APIRouter(prefix="/api")

@router.post("/waitlist/signup")
async def waitlist_signup(
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    email = body.get("email")
    tier = body.get("tier", "Free")
    
    if not email or not isinstance(email, str):
        raise HTTPException(status_code=400, detail="Email parameter is required")
        
    email_clean = email.lower().strip()
    status = "paid" if tier == "Free" else "pending"

    # Insert or update on conflict
    stmt = insert(WaitlistSignup).values(
        email=email_clean,
        tier=tier,
        status=status
    ).on_conflict_do_update(
        index_elements=["email"],
        set_={
            "tier": tier,
            "status": WaitlistSignup.status # keep paid if already paid, else pending/paid
        }
    )
    await db.execute(stmt)
    await db.commit()

    # Re-fetch for response
    refetch_stmt = select(WaitlistSignup).where(WaitlistSignup.email == email_clean)
    res = await db.execute(refetch_stmt)
    row = res.scalar_one_or_none()

    return {
        "success": True,
        "data": {
            "id": row.id,
            "email": row.email,
            "tier": row.tier,
            "status": row.status,
            "createdAt": row.created_at.isoformat() if row.created_at else None
        }
    }

@router.post("/billing/create-checkout-session")
async def create_checkout_session(
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    email = body.get("email")
    tier = body.get("tier")

    if not email or not tier:
        raise HTTPException(status_code=400, detail="Email and tier are required")

    email_clean = email.lower().strip()
    session_id = f"cs_{uuid.uuid4().hex[:16]}"
    
    # Pro: $199/yr, Lifetime: $499
    price_name = "Pro Access"
    amount = 19900  # in cents
    if tier == "Lifetime":
        price_name = "Lifetime Access"
        amount = 49900

    # Save initial pending state
    stmt = insert(WaitlistSignup).values(
        email=email_clean,
        tier=tier,
        status="pending",
        stripe_session_id=session_id
    ).on_conflict_do_update(
        index_elements=["email"],
        set_={
            "stripe_session_id": session_id,
            "tier": tier
        }
    )
    await db.execute(stmt)
    await db.commit()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY")
    if stripe_secret_key:
        try:
            import stripe
            stripe.api_key = stripe_secret_key
            
            frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
            session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{
                    'price_data': {
                        'currency': 'usd',
                        'product_data': {
                            'name': f'Gamma Exposure Terminal - {price_name}',
                            'description': 'Pre-order priority waitlist access and terminal premium tools.',
                        },
                        'unit_amount': amount,
                    },
                    'quantity': 1,
                }],
                mode='payment',
                customer_email=email_clean,
                success_url=f"{frontend_url}/dashboard?session_id={{CHECKOUT_SESSION_ID}}&checkout=success",
                cancel_url=f"{frontend_url}/?checkout=cancel",
            )

            # Update with the real Stripe session ID
            await db.execute(
                update(WaitlistSignup)
                .where(WaitlistSignup.email == email_clean)
                .values(stripe_session_id=session.id)
            )
            await db.commit()

            return {
                "success": True,
                "sessionId": session.id,
                "checkoutUrl": session.url
            }
        except Exception as e:
            logger.warning(f"Stripe checkout creation failed, falling back to simulation: {e}")

    # Fallback simulated checkout URL
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    simulated_url = f"{frontend_url}/checkout-session?session_id={session_id}&email={email_clean}&tier={tier}"
    return {
        "success": True,
        "sessionId": session_id,
        "checkoutUrl": simulated_url
    }

@router.post("/billing/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY")
    stripe_webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")

    payload = await request.body()
    event = None

    if stripe_secret_key and stripe_webhook_secret and stripe_signature:
        try:
            import stripe
            stripe.api_key = stripe_secret_key
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, stripe_webhook_secret
            )
        except Exception as e:
            logger.error(f"Webhook signature verification failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        # Simulated webhook event mapping
        try:
            import json
            event = json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed payload")

    if event and event.get("type") == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        session_id = session.get("id")
        email = session.get("customer_email") or session.get("customer_details", {}).get("email")
        
        logger.info(f"Stripe payment received for session {session_id} ({email})")
        
        if session_id:
            email_clean = email.lower().strip() if email else ""
            await db.execute(
                update(WaitlistSignup)
                .where((WaitlistSignup.stripe_session_id == session_id) | ((WaitlistSignup.email == email_clean) & (WaitlistSignup.status == "pending")))
                .values(status="paid")
            )
            await db.commit()

    return {"received": True}

@router.post("/billing/sim-payment-success")
async def sim_payment_success(
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    session_id = body.get("sessionId")
    email = body.get("email")

    if not session_id:
        raise HTTPException(status_code=400, detail="Session ID is required")

    email_clean = email.lower().strip() if email else ""

    stmt = (
        update(WaitlistSignup)
        .where((WaitlistSignup.stripe_session_id == session_id) | ((WaitlistSignup.email == email_clean) & (WaitlistSignup.status == "pending")))
        .values(status="paid")
        .returning(WaitlistSignup)
    )
    res = await db.execute(stmt)
    row = res.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="No pending waitlist entry found for this session/email")
        
    await db.commit()

    return {
        "success": True,
        "message": "Simulated payment processed successfully",
        "data": {
            "id": row[0].id,
            "email": row[0].email,
            "tier": row[0].tier,
            "status": row[0].status,
            "stripeSessionId": row[0].stripe_session_id
        }
    }
