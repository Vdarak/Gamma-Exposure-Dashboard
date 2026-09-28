"""add dealer_weights table for india gex

Revision ID: d4e5f6a7b8c9
Revises: a1b2c3d4e5f6
Create Date: 2026-09-28 11:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dealer_weights',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('date', sa.Date(), nullable=False, index=True),
        sa.Column('omega_ce', sa.Numeric(10, 6), nullable=False),
        sa.Column('omega_pe', sa.Numeric(10, 6), nullable=False),
        sa.Column('alpha', sa.Numeric(4, 2), server_default='0.5'),
        sa.Column('pro_call_long', sa.BigInteger()),
        sa.Column('pro_call_short', sa.BigInteger()),
        sa.Column('fii_call_long', sa.BigInteger()),
        sa.Column('fii_call_short', sa.BigInteger()),
        sa.Column('pro_put_long', sa.BigInteger()),
        sa.Column('pro_put_short', sa.BigInteger()),
        sa.Column('fii_put_long', sa.BigInteger()),
        sa.Column('fii_put_short', sa.BigInteger()),
        sa.Column('total_call_oi', sa.BigInteger()),
        sa.Column('total_put_oi', sa.BigInteger()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('date', name='uq_dealer_weights_date'),
    )


def downgrade() -> None:
    op.drop_table('dealer_weights')
