"""Add performance indexes for option net flow queries

Revision ID: a1b2c3d4e5f6
Revises: 3db43e3de48b
Create Date: 2026-07-01 03:26:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '3db43e3de48b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add composite indexes to accelerate the net flow LAG() window-function query.

    The main query joins option_snapshots → option_data, then runs a window function
    partitioned by (strike, option_type, expiration) ordered by timestamp.
    These indexes cover both the JOIN and the PARTITION ORDER BY.
    """
    # Index for fast snapshot lookup by ticker + date range (covers the WHERE clause)
    op.create_index(
        'idx_option_snapshots_ticker_timestamp',
        'option_snapshots',
        ['ticker', 'timestamp'],
        if_not_exists=True
    )

    # Composite index covering the JOIN key (snapshot_id) + the strike range filter
    # This lets Postgres use an index scan instead of sequential scan on option_data
    op.create_index(
        'idx_option_data_snapshot_strike',
        'option_data',
        ['snapshot_id', 'strike'],
        if_not_exists=True
    )

    # Composite index for the window function PARTITION BY (strike, option_type, expiration)
    # covering the JOIN key snapshot_id — critical for LAG() performance
    op.create_index(
        'idx_option_data_window_partition',
        'option_data',
        ['strike', 'option_type', 'expiration', 'snapshot_id'],
        if_not_exists=True
    )


def downgrade() -> None:
    """Remove the net flow performance indexes."""
    op.drop_index('idx_option_data_window_partition', table_name='option_data', if_exists=True)
    op.drop_index('idx_option_data_snapshot_strike', table_name='option_data', if_exists=True)
    op.drop_index('idx_option_snapshots_ticker_timestamp', table_name='option_snapshots', if_exists=True)
