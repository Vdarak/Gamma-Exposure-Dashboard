"""add participant_oi_daily table for historical participant tracking

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-29 15:58:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'participant_oi_daily',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('date', sa.Date(), nullable=False, unique=True, index=True),

        # Client (Retail)
        sa.Column('client_fut_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_fut_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_call_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_call_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_put_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_put_short', sa.BigInteger(), nullable=False, server_default='0'),

        # DII (Domestic Institutions)
        sa.Column('dii_fut_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_fut_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_call_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_call_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_put_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_put_short', sa.BigInteger(), nullable=False, server_default='0'),

        # FII (Foreign Institutional Investors)
        sa.Column('fii_fut_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_fut_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_call_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_call_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_put_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_put_short', sa.BigInteger(), nullable=False, server_default='0'),

        # Pro (Prop Desks & Market Makers)
        sa.Column('pro_fut_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_fut_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_call_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_call_short', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_put_long', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_put_short', sa.BigInteger(), nullable=False, server_default='0'),

        # Derived Quant Metrics
        sa.Column('fii_net_fut', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_net_ce', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_net_pe', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('fii_long_short_ratio', sa.Numeric(6, 4)),

        sa.Column('pro_net_fut', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_net_ce', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('pro_net_pe', sa.BigInteger(), nullable=False, server_default='0'),

        sa.Column('client_net_fut', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_net_ce', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('client_net_pe', sa.BigInteger(), nullable=False, server_default='0'),

        sa.Column('dii_net_fut', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_net_ce', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('dii_net_pe', sa.BigInteger(), nullable=False, server_default='0'),

        # Aggregate Market OI
        sa.Column('total_fut_oi', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('total_call_oi', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('total_put_oi', sa.BigInteger(), nullable=False, server_default='0'),

        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('date', name='uq_participant_oi_daily_date'),
    )


def downgrade() -> None:
    op.drop_table('participant_oi_daily')
